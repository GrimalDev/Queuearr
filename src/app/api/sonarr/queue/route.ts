import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { DownloadRetryError, downloadRetryErrorResponse, runDownloadRetry } from '@/lib/download-retry';
import { getMonitoredDownloadBySourceMedia, getLatestMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getCachedSonarrQueue, invalidateQueueCache } from '@/lib/queue-cache';
import { ensureDownloadSearchJob, parseDownloadScopes, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import { rememberTorrentIndexer } from '@/lib/db/torrent-indexers';
import { rememberDownloadTransfer } from '@/lib/db/download-transfers';
import { restrictQueueDiagnostics } from '@/lib/queue-errors';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const queue = await getCachedSonarrQueue(sonarr, { forceRefresh });
    for (const item of queue.records) {
      rememberTorrentIndexer('sonarr', item.downloadId, item.indexer, item.languages?.length ? item.languages : undefined);
      rememberDownloadTransfer('sonarr', item.seriesId, item.downloadId);
    }
    const filter = request.nextUrl.searchParams.get('filter') ?? 'mine';
    const records = queue.records.map((item) => restrictQueueDiagnostics(item, session.user.role === 'admin'));
    if (filter === 'all') {
      // Debug: Check if series data is included
      const sample = queue.records[0];
      if (sample && !sample.series) {
        console.log('[sonarr/queue] WARNING: series data not included in response. Sample item:', JSON.stringify({ id: sample.id, title: sample.title, seriesId: sample.seriesId, hasSeries: !!sample.series }));
      }
      return NextResponse.json(records);
    }
    const watchedIds = await getWatchedMediaIds(session.user.id, 'sonarr');
    const filtered = records.filter((item) => item.seriesId != null && watchedIds.has(item.seriesId));
    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Sonarr queue error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get queue';
    return NextResponse.json({ error: session.user.role === 'admin' ? message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

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
      retryAvailableAt = await runDownloadRetry('sonarr', mediaId, session.user, async () => {
        const queue = await sonarr.getQueue();
        if (ids.some((id) => !queue.records.some((item) => item.id === id && item.seriesId === mediaId))) {
          throw new DownloadRetryError('The queue entries do not belong to this title.');
        }
        const monitored = await getLatestMonitoredDownloadBySourceMedia('sonarr', mediaId);
        if (queue.records.some((item) => ids.includes(item.id) && isImportInProgress(item))) throw new DownloadRetryError('Import is in progress.');
        const saved = ensureDownloadSearchJob(monitored!.id, 'sonarr');
        let scopes = parseDownloadScopes(saved.scopes);
        if (!scopes.length) {
          const episodes = queue.records.filter((item) => ids.includes(item.id)).map((item) => item.episodeId ?? item.episode?.id);
          scopes = episodes.every((id) => Number.isSafeInteger(id) && id! > 0)
            ? episodes.map((episodeId) => ({ type: 'episode' as const, episodeId: episodeId! }))
            : [{ type: 'series' }];
        }
        updateDownloadSearchJob(saved.downloadId, { scopes: JSON.stringify(scopes), state: 'pending', indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
        await sonarr.deleteQueueItemBulk(ids, { blocklist: true, skipRedownload: true });
        if (monitored) await resetMonitoredDownload(monitored.id);
      });
    } else {
      await sonarr.deleteQueueItemBulk(ids, { blocklist: false, skipRedownload: false });
      if (mediaId) {
        const monitored = await getMonitoredDownloadBySourceMedia('sonarr', mediaId);
        if (monitored) await markDownloadCompleted(monitored.id);
      }
    }
    invalidateQueueCache(['sonarr-queue', 'transmission-state']);
    return NextResponse.json({ success: true, ...(retryAvailableAt ? { retryAvailableAt } : {}) });
  } catch (error) {
    return downloadRetryErrorResponse('sonarr queue retry', error);
  }
}
