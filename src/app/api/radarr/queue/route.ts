import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { smartGrab } from '@/lib/smart-grab';
import { getMonitoredDownloadBySourceMedia, markDownloadCompleted } from '@/lib/db/monitored-downloads';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  try {
    const queue = await radarr.getQueue(true);
    return NextResponse.json(queue.records);
  } catch (error) {
    console.error('Radarr queue error:', error);
    return NextResponse.json({ error: 'Failed to get queue' }, { status: 500 });
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
      await smartGrab({ source: 'radarr', mediaId });
    } else if (!retry && mediaId) {
      const monitored = await getMonitoredDownloadBySourceMedia('radarr', mediaId);
      if (monitored) await markDownloadCompleted(monitored.id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Radarr queue delete error:', error);
    return NextResponse.json({ error: 'Failed to remove from queue' }, { status: 500 });
  }
}
