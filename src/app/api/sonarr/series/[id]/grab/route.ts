import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { queueDownloadSearch } from '@/lib/db/download-search-jobs';
import { invalidateQueueCache } from '@/lib/queue-cache';

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
  const seriesId = Number(id);
  if (!Number.isSafeInteger(seriesId) || seriesId <= 0) {
    return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
  }

  try {
    const body = await request.json() as
      | { type: 'season'; seasonNumber: number }
      | { type: 'episode'; episodeId: number };

    if (!body || (body.type !== 'season' && body.type !== 'episode') ||
        (body.type === 'season' && (!Number.isSafeInteger(body.seasonNumber) || body.seasonNumber < 0)) ||
        (body.type === 'episode' && (!Number.isSafeInteger(body.episodeId) || body.episodeId <= 0))) {
      return NextResponse.json({ error: 'Invalid grab type' }, { status: 400 });
    }
    const series = await sonarr.getSeriesById(seriesId);
    if (body.type === 'episode' && !(await sonarr.getEpisodes(seriesId)).some((episode) => episode.id === body.episodeId)) {
      return NextResponse.json({ error: 'Error' }, { status: 400 });
    }
    queueDownloadSearch('sonarr', seriesId, series.title, session.user.id, body);

    invalidateQueueCache(['sonarr-queue', 'transmission-state']);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sonarr grab error:', error);
    return NextResponse.json({ error: 'Failed to trigger search' }, { status: 500 });
  }
}
