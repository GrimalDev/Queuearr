import { inArray, eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { downloadMediaChecks, monitoredDownloads } from '@/lib/db/schema';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import type { RadarrQueueItem, SonarrQueueItem } from '@/types';
import { getMovieAudioPolicies } from '@/lib/db/movie-audio';

export type DownloadMediaCheck = typeof downloadMediaChecks.$inferSelect;

export function getDownloadMediaChecks(ids?: number[]): DownloadMediaCheck[] {
  if (!ids) return db.select().from(downloadMediaChecks).all();
  const rows: DownloadMediaCheck[] = [];
  for (let start = 0; start < ids.length; start += 500) rows.push(...db.select().from(downloadMediaChecks)
    .where(inArray(downloadMediaChecks.downloadId, ids.slice(start, start + 500))).all());
  return rows;
}

export function saveDownloadMediaCheck(row: DownloadMediaCheck): void {
  db.insert(downloadMediaChecks).values(row).onConflictDoUpdate({ target: downloadMediaChecks.key, set: row }).run();
}

/** Revalidate source, media ID, request cycle and transfer hash before exposing a retryable failure. */
export function applyDownloadMediaFailures<T extends RadarrQueueItem | SonarrQueueItem>(source: 'radarr' | 'sonarr', items: T[]): T[] {
  const policies = source === 'radarr' ? [...getMovieAudioPolicies().values()] : [];
  const failures = db.select({ check: downloadMediaChecks, download: monitoredDownloads }).from(downloadMediaChecks)
    .innerJoin(monitoredDownloads, and(eq(downloadMediaChecks.downloadId, monitoredDownloads.id),
      eq(downloadMediaChecks.cycleStartedAt, monitoredDownloads.createdAt)))
    .where(and(eq(monitoredDownloads.source, source), isNull(monitoredDownloads.completedAt))).all();
  return items.map((item) => {
    const mediaId = 'movieId' in item ? item.movieId : 'seriesId' in item ? item.seriesId : undefined;
    const required = policies.find((policy) => policy.radarrMovieId === mediaId)?.requiredLanguages ?? item.languages?.slice(0, 1) ?? [];
    const languageScope = [...new Set(required.map((language) => language.id))].sort((left, right) => left - right).join(',');
    const failure = failures.find(({ check, download }) => !['cancelled', 'cancelling'].includes(download.lastStatus ?? '') &&
      check.hash === item.downloadId?.toLowerCase() && ['description_only', 'unsafe_files'].includes(check.state) &&
      mediaId === download.mediaId && (check.state === 'unsafe_files' || check.key === `${download.id}:${download.createdAt}:${check.hash}:${languageScope}`));
    if (!failure || isImportInProgress(item)) return item;
    return { ...item, errorMessage: failure.check.detail };
  });
}
