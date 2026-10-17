import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { acquireMovieAudioLock, getMovieAudioJobs, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || typeof body.tmdbId !== 'number' ||
      !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0) {
    return NextResponse.json({ error: 'Invalid movie ID.' }, { status: 400 });
  }
  const lock = acquireMovieAudioLock(body.tmdbId + 2);
  if (!lock) return NextResponse.json({ error: 'This movie is being processed.' }, { status: 409 });
  try {
    const job = getMovieAudioJobs().find((item) => item.tmdbId === body.tmdbId);
    if (!job || job.state !== 'needs_review' || job.restoreMonitored !== null) {
      return NextResponse.json({ error: 'This request is not ready for a review retry.' }, { status: 409 });
    }
    // Keep donor ownership and pending output: retry must revalidate, never redownload blindly.
    updateMovieAudioJob(body.tmdbId, { state: 'pending', detail: 'Review acknowledged. Checking the request again.', nextAttemptAt: 0 });
    return NextResponse.json({ state: 'pending', detail: 'Review acknowledged. Checking the request again.' });
  } catch { return NextResponse.json({ error: 'Could not retry this request.' }, { status: 503 }); }
  finally { releaseMovieAudioLock(lock); }
}
