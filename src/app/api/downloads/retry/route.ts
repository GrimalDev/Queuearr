import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getLatestMonitoredDownloadBySourceMedia, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { DownloadRetryError, downloadRetryErrorResponse, runDownloadRetry } from '@/lib/download-retry';
import { isMovieRegrab } from '@/lib/movie-audio-releases';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { ensureDownloadSearchJob, parseDownloadScopes, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Error' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('source' in body) || !('mediaId' in body) ||
      (body.source !== 'radarr' && body.source !== 'sonarr') || typeof body.mediaId !== 'number' ||
      !Number.isSafeInteger(body.mediaId) || body.mediaId <= 0 || body.mediaId > 2_147_483_647) {
    return NextResponse.json({ error: 'Error' }, { status: 400 });
  }
  const { source, mediaId } = body;
  let movieLock: string | null = null;
  try {
    const policy = source === 'radarr' ? [...getMovieAudioPolicies().values()].find((item) => item.radarrMovieId === mediaId) : undefined;
    if (policy) {
      movieLock = acquireMovieAudioLock(policy.tmdbId + 2);
      if (!movieLock) throw new DownloadRetryError('This movie is being processed.');
    }
    const job = policy ? getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId) : undefined;
    if (job && (job.donorHash || job.outputPath || job.restoreMonitored !== null || job.replaceDonor ||
        ['needs_review', 'validating', 'merging', 'verifying', 'available', 'cancelled', 'grab_pending'].includes(job.state))) {
      throw new DownloadRetryError('This audio job cannot restart its search.');
    }
    const retryAvailableAt = await runDownloadRetry(source, mediaId, session.user, async () => {
      if (source === 'sonarr') {
        const client = createSonarrClient();
        if (!client) throw new DownloadRetryError('Sonarr is not configured.', 503);
        if ((await client.getQueue()).records.some((item) => item.seriesId === mediaId)) {
          throw new DownloadRetryError('A series download already exists. Refresh its queue entry.');
        }
        const monitored = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
        const saved = ensureDownloadSearchJob(monitored!.id, source);
        // An explicit retry of a legacy request uses Sonarr's current monitoring.
        const scopes = parseDownloadScopes(saved.scopes);
        updateDownloadSearchJob(saved.downloadId, { scopes: JSON.stringify(scopes.length ? scopes : [{ type: 'series' }]),
          state: 'pending', searchFailures: 0, indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
      } else {
        const client = createRadarrClient();
        if (!client) throw new DownloadRetryError('Radarr is not configured.', 503);
        if ((await client.getQueue(false)).records.some((item) => item.movieId === mediaId)) {
          throw new DownloadRetryError('A movie download already exists. Refresh its queue entry.');
        }
        const movie = await client.getMovie(mediaId);
        if (job?.regrabFileId != null && policy) {
          if (movie.movieFile?.id !== job.regrabFileId) throw new DownloadRetryError('The replacement movie has already changed.');
          const profiles = await client.getQualityProfiles();
          const profile = profiles.find((item) => item.id === movie.qualityProfileId);
          const release = profile && (await client.getReleases(mediaId)).find((item) => isMovieRegrab(item, movie, policy.requiredLanguages, profile));
          if (!release) throw new DownloadRetryError('No eligible replacement release is available.');
          await client.grabRelease(release.guid, release.indexerId);
          updateMovieAudioJob(policy.tmdbId, { state: 'regrabbing', regrabRequestedAt: Date.now(),
            donorIndexer: release.indexer || `Indexer ${release.indexerId}`, estimatedLanguages: JSON.stringify(release.languages ?? []), nextAttemptAt: Date.now() + 30_000 });
        } else if (movie.hasFile) {
          if (!job || !policy) throw new DownloadRetryError('The movie is already available.');
          // The worker chooses an isolated audio donor and retains every media safety check.
          updateMovieAudioJob(policy.tmdbId, { state: 'pending', searchFailures: 0, detail: 'Searching for the requested audio.', nextAttemptAt: 0 });
        } else {
          if (policy) updateMovieAudioJob(policy.tmdbId, { state: 'pending', searchFailures: 0, detail: 'Searching for a movie release.', nextAttemptAt: 0 });
          else {
            const monitored = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
            const saved = ensureDownloadSearchJob(monitored!.id, source);
            if (saved.state === 'grab_pending' || saved.state === 'needs_review' && saved.submittedAt !== null) {
              throw new DownloadRetryError('The previous release submission needs review.');
            }
            updateDownloadSearchJob(saved.downloadId, { state: 'pending', searchFailures: 0, indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
          }
        }
      }
      const monitored = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
      if (monitored) await resetMonitoredDownload(monitored.id);
      invalidateQueueCache([source === 'radarr' ? 'radarr-queue' : 'sonarr-queue']);
    });
    return NextResponse.json({ state: 'pending', retryAvailableAt }, { status: 202 });
  } catch (cause) { return downloadRetryErrorResponse(`${source} ${mediaId} search`, cause); }
  finally { if (movieLock) releaseMovieAudioLock(movieLock); }
}
