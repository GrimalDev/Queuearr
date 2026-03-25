import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { smartGrab } from '@/lib/smart-grab';
import { getMonitoredDownloadBySourceMedia, getLatestMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getCachedSonarrQueue, invalidateQueueCache } from '@/lib/queue-cache';

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
    const filter = request.nextUrl.searchParams.get('filter') ?? 'mine';
    if (filter === 'all') {
      // Debug: Check if series data is included
      const sample = queue.records[0];
      if (sample && !sample.series) {
        console.log('[sonarr/queue] WARNING: series data not included in response. Sample item:', JSON.stringify({ id: sample.id, title: sample.title, seriesId: sample.seriesId, hasSeries: !!sample.series }));
      }
      return NextResponse.json(queue.records);
    }
    const watchedIds = await getWatchedMediaIds(session.user.id, 'sonarr');
    const filtered = queue.records.filter((item) => item.seriesId != null && watchedIds.has(item.seriesId));
    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Sonarr queue error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get queue';
    return NextResponse.json({ error: message }, { status: 500 });
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
    const { ids, retry, mediaId, episodeId } = await request.json() as {
      ids: number[];
      retry?: boolean;
      mediaId?: number;
      episodeId?: number;
    };
    await sonarr.deleteQueueItemBulk(ids, { blocklist: retry, skipRedownload: retry });
    if (retry && mediaId) {
      const monitored = await getLatestMonitoredDownloadBySourceMedia('sonarr', mediaId);
      if (monitored) await resetMonitoredDownload(monitored.id);
      await smartGrab({ source: 'sonarr', mediaId, episodeId });
    } else if (!retry && mediaId) {
      const monitored = await getMonitoredDownloadBySourceMedia('sonarr', mediaId);
      if (monitored) await markDownloadCompleted(monitored.id);
    }
    invalidateQueueCache(['sonarr-queue', 'transmission-state']);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sonarr queue delete error:', error);
    return NextResponse.json({ error: 'Failed to remove from queue' }, { status: 500 });
  }
}
