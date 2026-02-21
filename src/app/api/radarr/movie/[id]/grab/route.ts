import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { smartGrab } from '@/lib/smart-grab';
import {
  getMonitoredDownloadBySourceMedia,
  upsertMonitoredDownload,
  addUserToDownload,
} from '@/lib/db/monitored-downloads';


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
  const movieId = parseInt(id, 10);
  if (isNaN(movieId)) {
    return NextResponse.json({ error: 'Invalid movie ID' }, { status: 400 });
  }

  try {
    // Ensure there's a monitored download record so the user gets progress updates
    let monitored = await getMonitoredDownloadBySourceMedia('radarr', movieId);
    if (!monitored) {
      const movie = await radarr.getMovie(movieId);
      monitored = await upsertMonitoredDownload('radarr', movieId, movie.title);
    }
    // Always add the user (onConflictDoNothing handles duplicates)
    await addUserToDownload(monitored.id, session.user.id);

    void smartGrab({ source: 'radarr', mediaId: movieId }).catch((err) =>
      console.error('[smart-grab] radarr movie grab failed:', err)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Radarr movie grab error:', error);
    return NextResponse.json({ error: 'Failed to trigger grab' }, { status: 500 });
  }
}
