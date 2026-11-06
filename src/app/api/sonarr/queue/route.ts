import { retrySonarrQueue } from '@/lib/download-retry-actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { downloadRetryErrorResponse } from '@/lib/download-retry';
import { getMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds } from '@/lib/db/monitored-downloads';
import { getCachedSonarrQueue, invalidateQueueCache } from '@/lib/queue-cache';
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
      retryAvailableAt = await retrySonarrQueue(mediaId!, ids, session.user);
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
