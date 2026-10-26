import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { DownloadRetryError, downloadRetryErrorResponse, runDownloadRetry } from '@/lib/download-retry';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getMonitoredDownloadBySourceMedia, getLatestMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getCachedRadarrQueue, invalidateQueueCache } from '@/lib/queue-cache';
import { ensureDownloadSearchJob, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import { rememberTorrentIndexer } from '@/lib/db/torrent-indexers';
import { rememberDownloadTransfer } from '@/lib/db/download-transfers';
import { restrictQueueDiagnostics } from '@/lib/queue-errors';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const queue = await getCachedRadarrQueue(radarr, { forceRefresh });
    for (const item of queue.records) {
      rememberTorrentIndexer('radarr', item.downloadId, item.indexer, item.languages?.length ? item.languages : undefined);
      rememberDownloadTransfer('radarr', item.movieId, item.downloadId);
    }
    const filter = request.nextUrl.searchParams.get('filter') ?? 'mine';
    const records = queue.records.map((item) => restrictQueueDiagnostics(item, session.user.role === 'admin'));
    if (filter === 'all') {
      return NextResponse.json(records);
    }
    const watchedIds = await getWatchedMediaIds(session.user.id, 'radarr');
    const filtered = records.filter((item) => item.movieId != null && watchedIds.has(item.movieId));
    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Radarr queue error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get queue';
    return NextResponse.json({ error: session.user.role === 'admin' ? message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  let movieLock: string | null = null;
  try {
    const { ids, retry, mediaId } = await request.json() as {
      ids: number[];
      retry?: boolean;
      mediaId?: number;
    };
    let retryAvailableAt: number | undefined;
    if (retry) {
      if (!Number.isSafeInteger(mediaId) || !mediaId || mediaId <= 0 || !Array.isArray(ids) || !ids.length ||
          ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new DownloadRetryError('Invalid queue retry.', 400);
      const policy = [...getMovieAudioPolicies().values()].find((item) => item.radarrMovieId === mediaId);
      if (policy) {
        movieLock = acquireMovieAudioLock(policy.tmdbId + 2);
        if (!movieLock) throw new DownloadRetryError('This movie is being processed.');
        const job = getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId);
        if (job && (job.donorHash || job.outputPath || job.restoreMonitored !== null ||
            ['needs_review', 'validating', 'merging', 'verifying', 'grab_pending'].includes(job.state))) {
          throw new DownloadRetryError('The audio job cannot retry its movie download during processing.');
        }
      }
      retryAvailableAt = await runDownloadRetry('radarr', mediaId, session.user, async () => {
        const queue = await radarr.getQueue();
        if (ids.some((id) => !queue.records.some((item) => item.id === id && item.movieId === mediaId))) {
          throw new DownloadRetryError('The queue entries do not belong to this title.');
        }
        if (queue.records.some((item) => ids.includes(item.id) && isImportInProgress(item))) throw new DownloadRetryError('Import is in progress.');
        const monitored = await getLatestMonitoredDownloadBySourceMedia('radarr', mediaId);
        if (policy) updateMovieAudioJob(policy.tmdbId, { state: 'pending', detail: 'Searching for another movie release.', nextAttemptAt: 0 });
        else if (monitored) {
          ensureDownloadSearchJob(monitored.id, 'radarr');
          updateDownloadSearchJob(monitored.id, { state: 'pending', indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
        }
        await radarr.deleteQueueItemBulk(ids, { blocklist: true, skipRedownload: true });
        if (monitored) await resetMonitoredDownload(monitored.id);
      });
    } else {
      await radarr.deleteQueueItemBulk(ids, { blocklist: false, skipRedownload: false });
      if (mediaId) {
        const monitored = await getMonitoredDownloadBySourceMedia('radarr', mediaId);
        if (monitored) await markDownloadCompleted(monitored.id);
      }
    }
    invalidateQueueCache(['radarr-queue', 'transmission-state']);
    return NextResponse.json({ success: true, ...(retryAvailableAt ? { retryAvailableAt } : {}) });
  } catch (error) {
    return downloadRetryErrorResponse('radarr queue retry', error);
  } finally { if (movieLock) releaseMovieAudioLock(movieLock); }
}
