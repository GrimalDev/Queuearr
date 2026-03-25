import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { smartGrab } from '@/lib/smart-grab';
import { getMonitoredDownloadBySourceMedia, getLatestMonitoredDownloadBySourceMedia, markDownloadCompleted, getWatchedMediaIds, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getCachedRadarrQueue, invalidateQueueCache } from '@/lib/queue-cache';

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
    const filter = request.nextUrl.searchParams.get('filter') ?? 'mine';
    if (filter === 'all') {
      return NextResponse.json(queue.records);
    }
    const watchedIds = await getWatchedMediaIds(session.user.id, 'radarr');
    const filtered = queue.records.filter((item) => item.movieId != null && watchedIds.has(item.movieId));
    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Radarr queue error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get queue';
    return NextResponse.json({ error: message }, { status: 500 });
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
    await radarr.deleteQueueItemBulk(ids, { blocklist: retry, skipRedownload: retry });
    if (retry && mediaId) {
      const monitored = await getLatestMonitoredDownloadBySourceMedia('radarr', mediaId);
      if (monitored) await resetMonitoredDownload(monitored.id);
      await smartGrab({ source: 'radarr', mediaId });
    } else if (!retry && mediaId) {
      const monitored = await getMonitoredDownloadBySourceMedia('radarr', mediaId);
      if (monitored) await markDownloadCompleted(monitored.id);
    }
    invalidateQueueCache(['radarr-queue', 'transmission-state']);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Radarr queue delete error:', error);
    return NextResponse.json({ error: 'Failed to remove from queue' }, { status: 500 });
  }
}
