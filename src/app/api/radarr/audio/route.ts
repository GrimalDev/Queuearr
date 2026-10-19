import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getAvailableAudio, getPublicMovieAudioDetail, isMovieAudioLanguage, normalizeMovieAudioPolicy } from '@/lib/movie-audio-policy';
import { movieAudioErrorResponse } from '@/lib/movie-audio-errors';
import { MovieAudioRequestError, requestMovieAudio } from '@/lib/movie-audio-request';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!await getServerSession(authOptions)) return movieAudioErrorResponse('audio request', 401, 'Unauthorized');
  const tmdbId = Number(request.nextUrl.searchParams.get('tmdbId'));
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return movieAudioErrorResponse('audio status', 400, 'Invalid movie ID');
  try {
    const policy = getMovieAudioPolicies().get(tmdbId);
    const job = getMovieAudioJobs().find((item) => item.tmdbId === tmdbId);
    const client = createRadarrClient();
    const movie = policy && client ? await client.getMovie(policy.radarrMovieId) : undefined;
    return NextResponse.json({
      state: job?.state, detail: getPublicMovieAudioDetail(job?.state, job?.detail),
      requiredLanguages: policy && movie ? normalizeMovieAudioPolicy(policy, movie).requiredLanguages : policy?.requiredLanguages ?? [],
      availableLanguages: movie ? getAvailableAudio(movie) : [],
      hasFile: !!movie?.hasFile,
    });
  } catch (cause) { return movieAudioErrorResponse(`movie ${tmdbId} status`, 503, undefined, cause); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return movieAudioErrorResponse('audio request', 401, 'Unauthorized');
  const client = createRadarrClient();
  if (!client) return movieAudioErrorResponse('audio request', 503, 'Radarr is not configured.');
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || !('audioLanguage' in body) ||
      typeof body.tmdbId !== 'number' || !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0 ||
      !isMovieAudioLanguage(body.audioLanguage) ||
      ('forceDownload' in body && typeof body.forceDownload !== 'boolean')) {
    return movieAudioErrorResponse('audio request', 400, 'Choose a movie and Original, English or French audio.');
  }
  try {
    const result = await requestMovieAudio(client, body.tmdbId, body.audioLanguage, session.user.id,
      'forceDownload' in body && body.forceDownload === true);
    return NextResponse.json({ ...result, detail: getPublicMovieAudioDetail(result.state, result.detail) }, { status: result.state === 'available' ? 200 : 202 });
  } catch (error) {
    return movieAudioErrorResponse(`movie ${body.tmdbId} request`,
      error instanceof MovieAudioRequestError ? error.status : 503,
      error instanceof MovieAudioRequestError ? error.message : undefined, error);
  }
}
