import { retryAudioAlternative } from '@/lib/download-retry-actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { movieAudioErrorResponse } from '@/lib/movie-audio-errors';
import { downloadRetryErrorResponse } from '@/lib/download-retry';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return movieAudioErrorResponse('audio alternative', 401, 'Unauthorized');
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || typeof body.tmdbId !== 'number' ||
      !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0) return movieAudioErrorResponse('audio alternative', 400, 'Invalid movie ID.');
  const tmdbId = body.tmdbId;
  try {
    const retryAvailableAt = await retryAudioAlternative(tmdbId, session.user);
    return NextResponse.json({ state: 'pending', retryAvailableAt }, { status: 202 });
  } catch (cause) { return downloadRetryErrorResponse(`movie ${tmdbId} alternative`, cause); }
}
