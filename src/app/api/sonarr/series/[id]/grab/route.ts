import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { upsertMonitoredDownload, addUserToDownload } from '@/lib/db/monitored-downloads';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  const { id } = await params;
  const seriesId = parseInt(id, 10);
  if (isNaN(seriesId)) {
    return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
  }

  try {
    const body = await request.json() as
      | { type: 'season'; seasonNumber: number }
      | { type: 'episode'; episodeId: number };

    if (body.type === 'season') {
      await sonarr.triggerSeasonSearch(seriesId, body.seasonNumber);
    } else if (body.type === 'episode') {
      await sonarr.triggerEpisodeSearch([body.episodeId]);
    } else {
      return NextResponse.json({ error: 'Invalid grab type' }, { status: 400 });
    }

    // Track the download so the user gets notified on start/complete
    try {
      const series = await sonarr.getSeriesById(seriesId);
      const monitored = await upsertMonitoredDownload('sonarr', seriesId, series.title);
      await addUserToDownload(monitored.id, session.user.id);
    } catch (trackErr) {
      console.error('[sonarr grab] failed to track download or notify:', trackErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sonarr grab error:', error);
    return NextResponse.json({ error: 'Failed to trigger search' }, { status: 500 });
  }
}
