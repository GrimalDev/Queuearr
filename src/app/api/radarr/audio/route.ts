import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getAvailableAudio, isMovieAudioLanguage } from '@/lib/movie-audio-policy';
import { MovieAudioRequestError, requestMovieAudio } from '@/lib/movie-audio-request';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!await getServerSession(authOptions)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const tmdbId = Number(request.nextUrl.searchParams.get('tmdbId'));
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return NextResponse.json({ error: 'Invalid movie ID' }, { status: 400 });
  try {
    const policy = getMovieAudioPolicies().get(tmdbId);
    const job = getMovieAudioJobs().find((item) => item.tmdbId === tmdbId);
    const client = createRadarrClient();
    const movie = policy && client ? await client.getMovie(policy.radarrMovieId) : undefined;
    return NextResponse.json({
      state: job?.state, detail: job?.detail, requiredLanguages: policy?.requiredLanguages ?? [],
      availableLanguages: movie ? getAvailableAudio(movie) : [],
    });
  } catch { return NextResponse.json({ error: 'Could not refresh audio status.' }, { status: 503 }); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const client = createRadarrClient();
  if (!client) return NextResponse.json({ error: 'Radarr is not configured.' }, { status: 503 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || !('audioLanguage' in body) ||
      typeof body.tmdbId !== 'number' || !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0 ||
      !isMovieAudioLanguage(body.audioLanguage)) {
    return NextResponse.json({ error: 'Choose a movie and Original, English or French audio.' }, { status: 400 });
  }
  try {
    const result = await requestMovieAudio(client, body.tmdbId, body.audioLanguage, session.user.id);
    return NextResponse.json(result, { status: result.state === 'available' ? 200 : 202 });
  } catch (error) {
    if (error instanceof MovieAudioRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.warn('[audio] Could not save the language request.');
    return NextResponse.json({ error: 'Could not save the audio request. Check the Radarr connection and profile configuration.' }, { status: 503 });
  }
}
