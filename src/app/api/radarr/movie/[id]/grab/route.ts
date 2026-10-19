import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { queueDownloadSearch } from '@/lib/db/download-search-jobs';
import { invalidateQueueCache } from '@/lib/queue-cache';


export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  const { id } = await params;
  const movieId = Number(id);
  if (!Number.isSafeInteger(movieId) || movieId <= 0) {
    return NextResponse.json({ error: 'Invalid movie ID' }, { status: 400 });
  }

  try {
    const movie = await radarr.getMovie(movieId);
    queueDownloadSearch('radarr', movieId, movie.title, session.user.id, { type: 'movie' });
    invalidateQueueCache(['radarr-queue', 'transmission-state']);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Radarr movie grab error:', error);
    return NextResponse.json({ error: 'Failed to trigger grab' }, { status: 500 });
  }
}
