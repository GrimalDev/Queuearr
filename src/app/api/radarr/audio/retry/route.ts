import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { movieAudioErrorResponse } from '@/lib/movie-audio-errors';
import { acquireMovieAudioLock, getMovieAudioJobs, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') return movieAudioErrorResponse('audio retry', 403, 'Administrator access required.');
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || typeof body.tmdbId !== 'number' ||
      !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0) {
    return movieAudioErrorResponse('audio retry', 400, 'Invalid movie ID.');
  }
  const lock = acquireMovieAudioLock(body.tmdbId + 2);
  if (!lock) return movieAudioErrorResponse('audio retry', 409, 'This movie is being processed.');
  try {
    const job = getMovieAudioJobs().find((item) => item.tmdbId === body.tmdbId);
    if (!job || job.state !== 'needs_review' || job.restoreMonitored !== null) {
      return movieAudioErrorResponse('audio retry', 409, 'This request is not ready for a review retry.');
    }
    // Keep donor ownership and pending output: retry must revalidate, never redownload blindly.
    updateMovieAudioJob(body.tmdbId, { state: job.regrabFileId !== null ? 'regrabbing' : 'pending', searchFailures: 0, detail: 'Review acknowledged. Checking the request again.', nextAttemptAt: 0 });
    return NextResponse.json({ state: job.regrabFileId !== null ? 'regrabbing' : 'pending', detail: 'Review acknowledged. Checking the request again.' });
  } catch (cause) { return movieAudioErrorResponse(`movie ${body.tmdbId} retry`, 503, undefined, cause); }
  finally { releaseMovieAudioLock(lock); }
}
