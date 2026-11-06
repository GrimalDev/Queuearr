import { retryRadarrQueue } from '@/lib/download-retry-actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { downloadRetryErrorResponse } from '@/lib/download-retry';
import { getMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds } from '@/lib/db/monitored-downloads';
import { getCachedRadarrQueue, invalidateQueueCache } from '@/lib/queue-cache';
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

  try {
    const { ids, retry, mediaId } = await request.json() as {
      ids: number[];
      retry?: boolean;
      mediaId?: number;
    };
    let retryAvailableAt: number | undefined;
    if (retry) {
      retryAvailableAt = await retryRadarrQueue(mediaId!, ids, session.user);
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
  }
}
