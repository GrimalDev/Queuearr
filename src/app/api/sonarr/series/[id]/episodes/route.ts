import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
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
    const episodes = await sonarr.getEpisodes(seriesId);
    return NextResponse.json(episodes);
  } catch (error) {
    console.error('Sonarr episodes error:', error);
    return NextResponse.json({ error: 'Failed to fetch episodes' }, { status: 500 });
  }
}
