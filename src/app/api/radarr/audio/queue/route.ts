import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getWatchedMediaIds } from '@/lib/db/monitored-downloads';
import { getMovieAudioQueue } from '@/lib/movie-audio-queue';
import { movieAudioErrorResponse } from '@/lib/movie-audio-errors';
import { getCachedRadarrMovies } from '@/lib/queue-cache';
import { getDownloadRetryTimes } from '@/lib/download-retry';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return movieAudioErrorResponse('audio queue', 401, 'Unauthorized');
  try {
    // The ordinary movie watcher can finish before additional audio is merged.
    // Keep its requester association while using the audio job's own lifecycle.
    const watched = await getWatchedMediaIds(session.user.id, 'radarr', true);
    const visible = request.nextUrl.searchParams.get('filter') === 'all' ? undefined : watched;
    const settled = new Set((request.nextUrl.searchParams.get('settled') ?? '').split(',').slice(0, 20)
      .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    const policies = getMovieAudioPolicies();
    const jobs = getMovieAudioJobs().filter((job) => job.state !== 'cancelled' && (job.state !== 'available' || settled.has(job.tmdbId)) &&
      (!visible || visible.has(policies.get(job.tmdbId)?.radarrMovieId ?? -1)));
    if (!jobs.length) return NextResponse.json([]);
    const client = createRadarrClient();
    if (!client) return movieAudioErrorResponse('audio queue', 503, 'Radarr is not configured.');
    const items = getMovieAudioQueue(jobs, policies, await getCachedRadarrMovies(client), visible, settled);
    const retryTimes = getDownloadRetryTimes();
    return NextResponse.json(items.map((item) => ({ ...item,
      retryAvailableAt: retryTimes.get(`radarr:${item.mediaId}`),
      canRetrySearch: item.canRetrySearch && (session.user.role === 'admin' || watched.has(item.mediaId!)),
      ...(item.audio ? { audio: { ...item.audio,
      canRetry: item.audio.canRetry && (session.user.role === 'admin' || watched.has(item.mediaId!)),
      } } : {}),
    })));
  } catch (cause) { return movieAudioErrorResponse('audio queue', 503, undefined, cause); }
}
