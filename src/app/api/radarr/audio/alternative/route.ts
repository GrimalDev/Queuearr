import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getWatchedMediaIds } from '@/lib/db/monitored-downloads';
import { movieAudioErrorResponse } from '@/lib/movie-audio-errors';
import { rejectedAudioDonors } from '@/lib/movie-audio-attempts';
import { downloadRetryErrorResponse, runDownloadRetry } from '@/lib/download-retry';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return movieAudioErrorResponse('audio alternative', 401, 'Unauthorized');
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('tmdbId' in body) || typeof body.tmdbId !== 'number' ||
      !Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0) return movieAudioErrorResponse('audio alternative', 400, 'Invalid movie ID.');
  const tmdbId = body.tmdbId;
  const lock = acquireMovieAudioLock(tmdbId + 2);
  if (!lock) return movieAudioErrorResponse('audio alternative', 409, 'This movie is being processed.');
  try {
    const policy = getMovieAudioPolicies().get(tmdbId);
    const job = getMovieAudioJobs().find((item) => item.tmdbId === tmdbId);
    const watched = await getWatchedMediaIds(session.user.id, 'radarr', true);
    if (!policy || (session.user.role !== 'admin' && !watched.has(policy.radarrMovieId))) {
      return movieAudioErrorResponse('audio alternative', 403, 'Requester or administrator access required.');
    }
    if (!job?.donorHash || !job.donorLanguageId || job.outputPath || job.restoreMonitored !== null ||
        job.replaceDonor || !['pending', 'downloading', 'waiting_for_configuration'].includes(job.state)) {
      return movieAudioErrorResponse('audio alternative', 409, 'Only an unfinished audio download can switch releases.');
    }
    const rejected = rejectedAudioDonors(job.rejectedDonors);
    rejected.add(`hash:${job.donorHash.toLowerCase()}`);
    if (job.donorReleaseKey) rejected.add(job.donorReleaseKey);
    // The worker pauses and verifies this exact owned torrent before clearing its tracking.
    const retryAvailableAt = await runDownloadRetry('radarr', policy.radarrMovieId, session.user, async () => {
      updateMovieAudioJob(tmdbId, { rejectedDonors: JSON.stringify([...rejected]), replaceDonor: true,
        state: 'pending', detail: 'Searching for another audio release.', nextAttemptAt: 0 });
    });
    return NextResponse.json({ state: 'pending', retryAvailableAt }, { status: 202 });
  } catch (cause) { return downloadRetryErrorResponse(`movie ${body.tmdbId} alternative`, cause); }
  finally { releaseMovieAudioLock(lock); }
}
