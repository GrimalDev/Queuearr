import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { db } from '@/lib/db';
import { monitoredDownloads } from '@/lib/db/schema';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getLatestMonitoredDownloadBySourceMedia, isUserWatching } from '@/lib/db/monitored-downloads';
import { DownloadRetryError, downloadRetryErrorResponse } from '@/lib/download-retry';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { getDownloadSearchJobs, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Error' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('source' in body) || !('mediaId' in body) ||
      (body.source !== 'radarr' && body.source !== 'sonarr') || typeof body.mediaId !== 'number' ||
      !Number.isSafeInteger(body.mediaId) || body.mediaId <= 0 || body.mediaId > 2_147_483_647) {
    return NextResponse.json({ error: 'Error' }, { status: 400 });
  }
  const { source, mediaId } = body;
  let requestLock: string | null = null;
  let movieLock: string | null = null;
  try {
    // Share the retry lock so cancellation cannot race a manual search/retry.
    requestLock = acquireMovieAudioLock(-(mediaId * 2 + (source === 'sonarr' ? 1 : 0)));
    if (!requestLock) throw new DownloadRetryError('A request change is already in progress.');
    const download = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
    if (!download) throw new DownloadRetryError('The search request no longer exists.', 404);
    if (session.user.role !== 'admin' && !await isUserWatching(download.id, session.user.id)) {
      throw new DownloadRetryError('Requester or administrator access required.', 403);
    }
    const policy = source === 'radarr' ? [...getMovieAudioPolicies().values()].find((item) => item.radarrMovieId === mediaId) : undefined;
    if (policy) {
      movieLock = acquireMovieAudioLock(policy.tmdbId + 2);
      if (!movieLock) throw new DownloadRetryError('This movie is being processed.');
    }
    const job = policy ? getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId) : undefined;
    const searchJob = getDownloadSearchJobs().find((item) => item.downloadId === download.id);
    if (searchJob?.state === 'grab_pending') throw new DownloadRetryError('A release submission is already pending.');
    if (job ? job.donorHash || job.outputPath || job.restoreMonitored !== null || job.replaceDonor ||
        !['pending', 'downloading', 'regrabbing', 'waiting_for_configuration', 'search_failed', 'in_cinemas'].includes(job.state)
      : download.completedAt !== null || (!searchJob && download.lastStatus !== null)) {
      throw new DownloadRetryError('Only a pending search can be cancelled.');
    }
    const client = source === 'radarr' ? createRadarrClient() : createSonarrClient();
    if (!client) throw new DownloadRetryError('The download service is not configured.', 503);
    const queue = await client.getQueue();
    if (queue.records.some((item) => ('movieId' in item ? item.movieId : 'seriesId' in item ? item.seriesId : undefined) === mediaId)) {
      throw new DownloadRetryError('The download has started. Refresh and use its download controls.');
    }
    db.transaction(() => {
      db.update(monitoredDownloads).set({ completedAt: Date.now(), lastStatus: 'cancelled' })
        .where(eq(monitoredDownloads.id, download.id)).run();
      if (job) updateMovieAudioJob(job.tmdbId, { state: 'cancelled', detail: 'Search cancelled.', nextAttemptAt: 0,
        regrabFileId: null, regrabRequestedAt: null, donorIndexer: null });
      if (searchJob) updateDownloadSearchJob(download.id, { state: 'cancelled' });
    });
    invalidateQueueCache([source === 'radarr' ? 'radarr-queue' : 'sonarr-queue']);
    return NextResponse.json({ state: 'cancelled' });
  } catch (cause) { return downloadRetryErrorResponse(`${source} ${mediaId} cancel search`, cause); }
  finally {
    if (movieLock) releaseMovieAudioLock(movieLock);
    if (requestLock) releaseMovieAudioLock(requestLock);
  }
}
