import { and, eq, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { monitoredDownloads } from '@/lib/db/schema';
import { acquireMovieAudioLock, releaseMovieAudioLock } from '@/lib/db/movie-audio';
import { getLatestMonitoredDownloadBySourceMedia, isUserWatching, upsertMonitoredDownload } from '@/lib/db/monitored-downloads';
import { DOWNLOAD_RETRY_COOLDOWN_MS, downloadRetryAvailableAt } from '@/lib/download-retry-policy';

export class DownloadRetryError extends Error {
  constructor(message: string, public status = 409, public retryAvailableAt?: number) { super(message); }
}

export function getDownloadRetryTimes(): Map<string, number> {
  return new Map(db.select().from(monitoredDownloads).all().map((row) =>
    [`${row.source}:${row.mediaId}`, downloadRetryAvailableAt(row)]));
}

export function startDownloadRetryCooldown(source: 'radarr' | 'sonarr', mediaId: number): void {
  const next = Date.now() + DOWNLOAD_RETRY_COOLDOWN_MS;
  db.update(monitoredDownloads).set({ retryAfter: sql`max(${monitoredDownloads.retryAfter}, ${next})` })
    .where(and(eq(monitoredDownloads.source, source), eq(monitoredDownloads.mediaId, mediaId))).run();
}

export async function runDownloadRetry(
  source: 'radarr' | 'sonarr', mediaId: number, actor: { id: string; role: string },
  operation: () => Promise<void>,
): Promise<number> {
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || mediaId > 2_147_483_647) {
    throw new DownloadRetryError('Invalid media ID.', 400);
  }
  // Negative lock IDs are a separate namespace from the audio worker's nonnegative IDs.
  const lock = acquireMovieAudioLock(-(mediaId * 2 + (source === 'sonarr' ? 1 : 0)));
  if (!lock) throw new DownloadRetryError('A retry is already in progress.');
  try {
    let download = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
    const admin = actor.role === 'admin';
    if (!admin && (!download || !await isUserWatching(download.id, actor.id))) {
      throw new DownloadRetryError('Requester or administrator access required.', 403);
    }
    if (!download) download = await upsertMonitoredDownload(source, mediaId, `${source} ${mediaId}`);
    const now = Date.now();
    const retryAvailableAt = now + DOWNLOAD_RETRY_COOLDOWN_MS;
    const claimed = db.update(monitoredDownloads).set({ retryAfter: retryAvailableAt })
      .where(and(eq(monitoredDownloads.id, download.id),
        ...(admin ? [] : [lte(monitoredDownloads.retryAfter, now), lte(monitoredDownloads.createdAt, now - DOWNLOAD_RETRY_COOLDOWN_MS)])))
      .returning().get();
    if (!claimed) {
      const current = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
      throw new DownloadRetryError('The five-minute retry cooldown is active.', 429,
        current ? downloadRetryAvailableAt(current) : retryAvailableAt);
    }
    // Persist the reservation before external effects, including failed retry attempts.
    await operation();
    return retryAvailableAt;
  } finally { releaseMovieAudioLock(lock); }
}

export function downloadRetryErrorResponse(context: string, cause: unknown): NextResponse {
  const known = cause instanceof DownloadRetryError;
  const retryAvailableAt = known ? cause.retryAvailableAt : undefined;
  console.warn(`[downloads] ${context}: ${known ? cause.message : 'Retry failed.'}`);
  return NextResponse.json({ error: 'Error', ...(retryAvailableAt ? { retryAvailableAt } : {}) }, {
    status: known ? cause.status : 503,
    ...(retryAvailableAt ? { headers: { 'Retry-After': String(Math.max(1, Math.ceil((retryAvailableAt - Date.now()) / 1000))) } } : {}),
  });
}
