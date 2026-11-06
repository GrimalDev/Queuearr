import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { DownloadRetryError, runDownloadRetry } from '@/lib/download-retry';
import type { DownloadRetryActor } from '@/types';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getLatestMonitoredDownloadBySourceMedia, resetMonitoredDownload, saveTrackedRequest } from '@/lib/db/monitored-downloads';
import { ensureDownloadSearchJob, getDownloadSearchJobs, parseDownloadScopes, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import { getSonarrRetryItems, sonarrQueueItemMatchesScope } from '@/lib/sonarr-search-scopes';
import { automaticSearchRetryKey, isAutomaticRetryFailure } from '@/lib/automatic-retry-policy';
import { isMovieRegrab } from '@/lib/movie-audio-releases';
import { rejectedAudioDonors } from '@/lib/movie-audio-attempts';
import { createTransmissionClient } from '@/lib/api/transmission';
import { db } from '@/lib/db';

export async function retryRadarrQueue(mediaId: number, ids: number[], actor: DownloadRetryActor): Promise<number> {
  const radarr = createRadarrClient();
  if (!radarr) throw new DownloadRetryError('Radarr is not configured.', 503);
  let movieLock: string | null = null;
  try {
    if (!Number.isSafeInteger(mediaId) || !mediaId || mediaId <= 0 || !Array.isArray(ids) || !ids.length ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new DownloadRetryError('Invalid queue retry.', 400);
    const policy = [...getMovieAudioPolicies().values()].find((item) => item.radarrMovieId === mediaId);
    if (policy) {
      movieLock = acquireMovieAudioLock(policy.tmdbId + 2);
      if (!movieLock) throw new DownloadRetryError('This movie is being processed.');
      const job = getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId);
      if (job && (job.donorHash || job.outputPath || job.restoreMonitored !== null ||
          ['needs_review', 'validating', 'merging', 'verifying', 'grab_pending'].includes(job.state))) {
        throw new DownloadRetryError('The audio job cannot retry its movie download during processing.');
      }
    }
    return await runDownloadRetry('radarr', mediaId, actor, async () => {
      const queue = await radarr.getQueue();
      if (ids.some((id) => !queue.records.some((item) => item.id === id && item.movieId === mediaId))) {
        throw new DownloadRetryError('The queue entries do not belong to this title.');
      }
      if (queue.records.some((item) => ids.includes(item.id) && isImportInProgress(item))) throw new DownloadRetryError('Import is in progress.');
      const monitored = await getLatestMonitoredDownloadBySourceMedia('radarr', mediaId);
      if ('automaticKey' in actor && queue.records.filter((item) => ids.includes(item.id)).some((item) =>
        !isAutomaticRetryFailure(item) || actor.automaticKey !== `${monitored!.id}:queue:${item.downloadId?.toLowerCase() || item.id}`)) {
        throw new DownloadRetryError('The failed transfer has changed or recovered.');
      }

      await radarr.deleteQueueItemBulk(ids, { blocklist: true, skipRedownload: true });
      if (policy) updateMovieAudioJob(policy.tmdbId, { state: 'pending', searchFailures: 0, detail: 'Searching for another movie release.', nextAttemptAt: 0 });
      else if (monitored) {
        ensureDownloadSearchJob(monitored.id, 'radarr');
        updateDownloadSearchJob(monitored.id, { state: 'pending', searchFailures: 0, indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
      }
      if (monitored) await resetMonitoredDownload(monitored.id);
    });
  } finally {
    invalidateQueueCache(['radarr-queue', 'transmission-state']);
    if (movieLock) releaseMovieAudioLock(movieLock);
  }
}

export async function retrySonarrQueue(mediaId: number, ids: number[], actor: DownloadRetryActor): Promise<number> {
  const sonarr = createSonarrClient();
  if (!sonarr) throw new DownloadRetryError('Sonarr is not configured.', 503);
  try {
    if (!Number.isSafeInteger(mediaId) || !mediaId || mediaId <= 0 || !Array.isArray(ids) || !ids.length ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new DownloadRetryError('Invalid queue retry.', 400);
    return await runDownloadRetry('sonarr', mediaId, actor, async () => {
      const queue = await sonarr.getQueue();
      if (ids.some((id) => !queue.records.some((item) => item.id === id && item.seriesId === mediaId))) {
        throw new DownloadRetryError('The queue entries do not belong to this title.');
      }
      const monitored = await getLatestMonitoredDownloadBySourceMedia('sonarr', mediaId);
      if ('automaticKey' in actor && queue.records.filter((item) => ids.includes(item.id)).some((item) =>
        !isAutomaticRetryFailure(item) || actor.automaticKey !== `${monitored!.id}:queue:${item.downloadId?.toLowerCase() || item.id}`)) {
        throw new DownloadRetryError('The failed transfer has changed or recovered.');
      }
      const affected = getSonarrRetryItems(queue.records, ids);
      if (affected.some((item) => item.seriesId !== mediaId)) throw new DownloadRetryError('The transfer contains another series. Review is required.');
      if (affected.some(isImportInProgress)) throw new DownloadRetryError('Import is in progress.');
      const episodes = [...new Set(affected.map((item) => item.episodeId ?? item.episode?.id))];
      if (!episodes.length || episodes.some((id) => !Number.isSafeInteger(id) || id! <= 0)) {
        throw new DownloadRetryError('The affected episodes could not be identified.');
      }
      const saved = ensureDownloadSearchJob(monitored!.id, 'sonarr');
      // Retain outstanding selections while ensuring the retried transfer is included.
      const retained = monitored!.lastStatus !== 'cancelled' && ['pending', 'searching', 'downloading', 'search_failed'].includes(saved.state)
        ? parseDownloadScopes(saved.scopes) : [];
      const scopes = [...new Map([...retained, ...episodes.map((episodeId) => ({ type: 'episode' as const, episodeId: episodeId! }))]
        .map((scope) => [JSON.stringify(scope), scope])).values()];
      if (scopes.length > 100) throw new DownloadRetryError('Too many pending episode selections.');
      await sonarr.deleteQueueItemBulk(ids, { blocklist: true, skipRedownload: true });
      db.transaction(() => {
        if (monitored?.lastStatus === 'cancelled' && !('automaticKey' in actor)) {
          for (const scope of scopes) saveTrackedRequest('sonarr', mediaId, monitored.title, actor.id, scope);
        }
        updateDownloadSearchJob(saved.downloadId, { scopes: JSON.stringify(scopes), state: 'pending', searchFailures: 0, indexer: null, estimatedLanguages: '[]', submittedAt: null, nextAttemptAt: 0 });
      });
      if (monitored) await resetMonitoredDownload(monitored.id);
    }, { restartCancelledQueue: true });
  } finally { invalidateQueueCache(['sonarr-queue', 'transmission-state']); }
}

export async function retryDownloadSearch(source: 'radarr' | 'sonarr', mediaId: number, actor: DownloadRetryActor): Promise<number> {
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
    return await runDownloadRetry(source, mediaId, actor, async () => {
      if ('automaticKey' in actor) {
        const saved = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
        const search = saved ? getDownloadSearchJobs().find((item) => item.downloadId === saved.id) : undefined;
        if (job ? !['search_failed', 'waiting_for_configuration'].includes(job.state) : search?.state !== 'search_failed') {
          throw new DownloadRetryError('The search is no longer failed.');
        }
        if (actor.automaticKey !== automaticSearchRetryKey(saved!.id, job?.updatedAt ?? search?.submittedAt ?? search?.updatedAt ?? 0)) {
          throw new DownloadRetryError('The search has already been retried.');
        }
      }
      if (source === 'sonarr') {
        const client = createSonarrClient();
        if (!client) throw new DownloadRetryError('Sonarr is not configured.', 503);
        const monitored = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
        const saved = ensureDownloadSearchJob(monitored!.id, source);
        // An explicit retry of a legacy request uses Sonarr's current monitoring.
        const scopes = parseDownloadScopes(saved.scopes);
        if ((await client.getQueue()).records.some((item) => item.seriesId === mediaId &&
            (!scopes.length || scopes.some((scope) => sonarrQueueItemMatchesScope(item, scope))))) {
          throw new DownloadRetryError('A download already exists for this selection. Refresh its queue entry.');
        }
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
  } finally { if (movieLock) releaseMovieAudioLock(movieLock); }
}

export async function retryAudioAlternative(tmdbId: number, actor: DownloadRetryActor): Promise<number> {
  const lock = acquireMovieAudioLock(tmdbId + 2);
  if (!lock) throw new DownloadRetryError('This movie is being processed.');
  try {
    const policy = getMovieAudioPolicies().get(tmdbId);
    const job = getMovieAudioJobs().find((item) => item.tmdbId === tmdbId);
    if (!policy) throw new DownloadRetryError('Audio policy not found.', 404);
    if (!job?.donorHash || !job.donorLanguageId || job.outputPath || job.restoreMonitored !== null ||
        job.replaceDonor || !['pending', 'downloading', 'waiting_for_configuration'].includes(job.state)) {
      throw new DownloadRetryError('Only an unfinished audio download can switch releases.');
    }
    const rejected = rejectedAudioDonors(job.rejectedDonors);
    rejected.add(`hash:${job.donorHash.toLowerCase()}`);
    if (job.donorReleaseKey) rejected.add(job.donorReleaseKey);
    // The worker pauses and verifies this exact owned torrent before clearing its tracking.
    return await runDownloadRetry('radarr', policy.radarrMovieId, actor, async () => {
      if ('automaticKey' in actor) {
        const transmission = createTransmissionClient();
        const torrent = transmission && (await transmission.getTorrents()).find((item) => item.hashString.toLowerCase() === job.donorHash!.toLowerCase());
        if (!torrent || torrent.percentDone >= 1 || (!torrent.error && job.state !== 'waiting_for_configuration')) throw new DownloadRetryError('The audio transfer is no longer failed.');
      }
      updateMovieAudioJob(tmdbId, { rejectedDonors: JSON.stringify([...rejected]), replaceDonor: true, searchFailures: 0,
        state: 'pending', detail: 'Searching for another audio release.', nextAttemptAt: 0 });
    });
  } finally { releaseMovieAudioLock(lock); }
}
