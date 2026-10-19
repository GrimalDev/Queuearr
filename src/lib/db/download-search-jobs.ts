import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { downloadSearchJobs, monitoredDownloads, monitoredDownloadUsers, movieAudioJobs, movieAudioPolicies } from '@/lib/db/schema';
import { saveTrackedRequest } from '@/lib/db/monitored-downloads';
import { acquireMovieAudioLock, releaseMovieAudioLock } from '@/lib/db/movie-audio';
import type { DownloadSearchScope } from '@/types';

export type DownloadSearchJob = typeof downloadSearchJobs.$inferSelect;

export function parseDownloadScopes(value: string): DownloadSearchScope[] {
  const scopes: unknown = JSON.parse(value);
  if (!Array.isArray(scopes) || scopes.length > 100) throw new Error('Invalid saved download scope.');
  return scopes.map((scope: unknown): DownloadSearchScope => {
    if (!scope || typeof scope !== 'object' || !('type' in scope)) throw new Error('Invalid saved download scope.');
    if (scope.type === 'movie' || scope.type === 'series') return { type: scope.type };
    if (scope.type === 'season' && 'seasonNumber' in scope && Number.isSafeInteger(scope.seasonNumber) && Number(scope.seasonNumber) >= 0) {
      return { type: 'season', seasonNumber: Number(scope.seasonNumber) };
    }
    if (scope.type === 'episode' && 'episodeId' in scope && Number.isSafeInteger(scope.episodeId) && Number(scope.episodeId) > 0) {
      return { type: 'episode', episodeId: Number(scope.episodeId) };
    }
    throw new Error('Invalid saved download scope.');
  });
}

export function getDownloadSearchJobs(): DownloadSearchJob[] {
  return db.select().from(downloadSearchJobs).all();
}

export function updateDownloadSearchJob(downloadId: number, changes: Partial<Omit<DownloadSearchJob, 'downloadId'>>): void {
  db.update(downloadSearchJobs).set({ ...changes, updatedAt: Date.now() }).where(eq(downloadSearchJobs.downloadId, downloadId)).run();
}

export function ensureDownloadSearchJob(downloadId: number, source: 'radarr' | 'sonarr'): DownloadSearchJob {
  db.insert(downloadSearchJobs).values({ downloadId, scopes: source === 'radarr' ? JSON.stringify([{ type: 'movie' }]) : '[]',
    state: source === 'radarr' ? 'pending' : 'needs_selection', updatedAt: Date.now() }).onConflictDoNothing().run();
  return db.select().from(downloadSearchJobs).where(eq(downloadSearchJobs.downloadId, downloadId)).get()!;
}

export function queueDownloadSearch(source: 'radarr' | 'sonarr', mediaId: number, title: string, userId: string, scope: DownloadSearchScope): void {
  if ((source === 'radarr') !== (scope.type === 'movie')) throw new Error('Invalid download scope for service.');
  const lock = acquireMovieAudioLock(-(mediaId * 2 + (source === 'sonarr' ? 1 : 0)));
  if (!lock) throw new Error('This request is already being processed.');
  try { db.transaction(() => {
    const prior = db.select().from(monitoredDownloads).where(and(eq(monitoredDownloads.source, source), eq(monitoredDownloads.mediaId, mediaId))).get();
    const existing = prior ? db.select().from(downloadSearchJobs).where(eq(downloadSearchJobs.downloadId, prior.id)).get() : undefined;
    if (existing?.state === 'grab_pending') throw new Error('A release submission is already pending.');
    const retained = prior?.completedAt === null && existing && !['cancelled', 'complete', 'needs_selection'].includes(existing.state)
      ? parseDownloadScopes(existing.scopes) : [];
    const scopes = [...new Map([...retained, scope].map((item) => [JSON.stringify(item), item])).values()];
    if (scopes.length > 100) throw new Error('Too many pending download selections.');
    const tracked = saveTrackedRequest(source, mediaId, title, userId);
    const values = { scopes: JSON.stringify(scopes), state: 'pending', searchFailures: 0, indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0, updatedAt: Date.now() };
    db.insert(downloadSearchJobs).values({ downloadId: tracked.id, ...values })
      .onConflictDoUpdate({ target: downloadSearchJobs.downloadId, set: values }).run();
  }); } finally { releaseMovieAudioLock(lock); }
}

/** Recover saved requests only. Auto-discovered rows without requesters need explicit selection. */
export function recoverDownloadSearchJobs(): number {
  return db.transaction(() => {
    let recovered = 0;
    for (const tracked of db.select().from(monitoredDownloads).where(and(isNull(monitoredDownloads.completedAt), isNull(monitoredDownloads.lastStatus))).all()) {
      const requested = db.select().from(monitoredDownloadUsers).where(eq(monitoredDownloadUsers.downloadId, tracked.id)).get();
      const policy = tracked.source === 'radarr' ? db.select().from(movieAudioPolicies).where(eq(movieAudioPolicies.radarrMovieId, tracked.mediaId)).get() : undefined;
      if (policy) {
        if (requested) recovered += db.insert(movieAudioJobs).values({ tmdbId: policy.tmdbId, updatedAt: Date.now() }).onConflictDoNothing().run().changes;
        continue;
      }
      recovered += db.insert(downloadSearchJobs).values({ downloadId: tracked.id,
        scopes: tracked.source === 'radarr' ? JSON.stringify([{ type: 'movie' }]) : '[]',
        state: tracked.source === 'sonarr' ? 'needs_selection' : requested ? 'pending' : 'needs_review', updatedAt: Date.now(),
      }).onConflictDoNothing().run().changes;
    }
    return recovered;
  });
}
