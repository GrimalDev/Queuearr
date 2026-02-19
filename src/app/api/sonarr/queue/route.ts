import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { smartGrab } from '@/lib/smart-grab';
import { getMonitoredDownloadBySourceMedia, markDownloadCompleted } from '@/lib/db/monitored-downloads';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  try {
    const queue = await sonarr.getQueue(true, true);
    return NextResponse.json(queue.records);
  } catch (error) {
    console.error('Sonarr queue error:', error);
    return NextResponse.json({ error: 'Failed to get queue' }, { status: 500 });
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
    await sonarr.deleteQueueItemBulk(ids, { blocklist: retry });
    if (retry && mediaId) {
      await smartGrab({ source: 'sonarr', mediaId, episodeId });
    } else if (!retry && mediaId) {
      const monitored = await getMonitoredDownloadBySourceMedia('sonarr', mediaId);
      if (monitored) await markDownloadCompleted(monitored.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sonarr queue delete error:', error);
    return NextResponse.json({ error: 'Failed to remove from queue' }, { status: 500 });
  }
}
