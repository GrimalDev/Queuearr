import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { acquireMovieAudioLock, releaseMovieAudioLock, renewMovieAudioLock, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getActiveMonitoredDownloads } from '@/lib/db/monitored-downloads';
import { getDownloadSearchJobs, parseDownloadScopes, recoverDownloadSearchJobs, updateDownloadSearchJob, type DownloadSearchJob } from '@/lib/db/download-search-jobs';
import { logMovieAudioError } from '@/lib/movie-audio-errors';
import { pickBestRelease } from '@/lib/smart-grab';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { isMovieInCinemas } from '@/lib/movie-release-status';
import { releaseSearchRetry, summarizeReleaseSearch } from '@/lib/release-search-retry';
import { episodeMatchesSearchScope, getUnqueuedSonarrSearchScopes } from '@/lib/sonarr-search-scopes';
import { describeDownloadSearchError, describeRejectedMovieReleases } from '@/lib/download-search-errors';

const ACTIVE_SEARCH_STATES = ['pending', 'searching', 'grab_pending', 'downloading', 'search_failed', 'in_cinemas', 'waiting_for_airdate', 'waiting_for_release'];

function later(job: DownloadSearchJob, state: string, delay = 30_000, detail: string | null = null): void {
  updateDownloadSearchJob(job.downloadId, { state, detail, nextAttemptAt: Date.now() + delay });
}

export async function runDownloadSearchJobs(): Promise<void> {
  // -1 is separate from the audio worker and all per-title retry locks.
  const workerLock = acquireMovieAudioLock(-1);
  if (!workerLock) return;
  let titleLock: string | null = null;
  let movieLock: string | null = null;
  let lostLease = false;
  const heartbeat = setInterval(() => {
    try { lostLease = !renewMovieAudioLock(workerLock) || !!titleLock && !renewMovieAudioLock(titleLock) || !!movieLock && !renewMovieAudioLock(movieLock); }
    catch { lostLease = true; }
  }, 30_000);
  try {
    const recovered = recoverDownloadSearchJobs();
    if (recovered) console.info(`[downloads] recovered ${recovered} missing search job(s)`);
    const active = new Map((await getActiveMonitoredDownloads()).map((download) => [download.id, download]));
    for (const saved of getDownloadSearchJobs()) {
      if (lostLease) break;
      const download = active.get(saved.downloadId);
      if (!download || !ACTIVE_SEARCH_STATES.includes(saved.state) || saved.nextAttemptAt > Date.now()) continue;
      if (download.source !== 'radarr' && download.source !== 'sonarr') continue;
      titleLock = acquireMovieAudioLock(-(download.mediaId * 2 + (download.source === 'sonarr' ? 1 : 0)));
      if (!titleLock) continue;
      let operation = 'Reading the saved search selection';
      try {
        const job = getDownloadSearchJobs().find((item) => item.downloadId === saved.downloadId);
        // Re-read after locking: cancellation or a new request can change the job.
        const current = (await getActiveMonitoredDownloads()).find((item) => item.id === saved.downloadId);
        if (!job || !current || !ACTIVE_SEARCH_STATES.includes(job.state)) continue;
        const scopes = parseDownloadScopes(job.scopes);
        if (!scopes.length || scopes.some((scope) => (scope.type === 'movie') !== (download.source === 'radarr'))) {
          later(job, 'needs_selection', 30_000, 'The saved search selection is empty or belongs to a different service. Select the movie, seasons or episodes again.'); continue;
        }
        if (download.source === 'radarr') {
          // A language request owns its own job and movie locks. Never compete with it.
          if ([...getMovieAudioPolicies().values()].some((policy) => policy.radarrMovieId === download.mediaId)) {
            later(job, 'cancelled'); continue;
          }
          const client = createRadarrClient();
          if (!client) { later(job, 'search_failed', 15 * 60_000, 'Radarr is not configured. Set its URL and API key before retrying.'); continue; }
          operation = 'Reading movie information';
          const movie = await client.getMovie(download.mediaId);
          movieLock = acquireMovieAudioLock(movie.tmdbId + 2);
          if (!movieLock) continue;
          if ([...getMovieAudioPolicies().values()].some((policy) => policy.radarrMovieId === download.mediaId)) { later(job, 'cancelled'); continue; }
          if (movie.hasFile) { later(job, 'complete'); continue; }
          operation = 'Reading the download queue';
          if ((await client.getQueue(false)).records.some((item) => item.movieId === download.mediaId)) {
            later(job, job.state === 'pending' ? 'pending' : 'downloading'); continue;
          }
          if (job.state === 'grab_pending') {
            if (Date.now() - (job.submittedAt ?? job.updatedAt) >= 5 * 60_000) {
              console.warn(`[downloads] radarr ${download.mediaId}: submission has no queue entry; review required`);
              later(job, 'needs_review', 30_000, 'The release was submitted to Radarr, but no download appeared within five minutes. Review Radarr before submitting another release.' +
                (job.detail ? ` Last submission diagnostic: ${job.detail}` : ''));
            }
            continue;
          }
          operation = 'Checking the movie search command';
          if (await client.hasActiveMovieSearch(download.mediaId)) { later(job, 'searching'); continue; }
          operation = 'Searching movie releases';
          const releases = await client.getReleases(download.mediaId);
          const candidate = pickBestRelease(releases);
          if (!candidate) {
            const retry = releaseSearchRetry(job.searchFailures);
            const inCinemas = isMovieInCinemas(movie);
            console.warn(`[downloads] radarr ${download.mediaId}: no accepted release`, { ...summarizeReleaseSearch(releases), attempt: retry.failures });
            updateDownloadSearchJob(job.downloadId, { searchFailures: retry.failures });
            later(job, inCinemas ? 'in_cinemas' : retry.confirming ? 'searching' : 'search_failed', inCinemas ? 15 * 60_000 : retry.delay,
              (inCinemas ? 'The movie is still in cinemas. ' : '') + describeRejectedMovieReleases(releases)); continue;
          }
          if (lostLease) break;
          operation = 'Checking the queue before submitting a release';
          if ((await client.getQueue(false)).records.some((item) => item.movieId === download.mediaId)) { later(job, 'downloading'); continue; }
          operation = 'Checking the movie before submitting a release';
          if ((await client.getMovie(download.mediaId)).hasFile) { later(job, 'complete'); continue; }
          updateDownloadSearchJob(job.downloadId, { state: 'grab_pending', detail: null, searchFailures: 0, indexer: candidate.indexer || `Indexer ${candidate.indexerId}`, estimatedLanguages: JSON.stringify(candidate.languages ?? []),
            submittedAt: Date.now(), nextAttemptAt: Date.now() + 30_000 });
          try { await client.grabRelease(candidate.guid, candidate.indexerId); }
          catch (cause) {
            updateDownloadSearchJob(job.downloadId, { detail: describeDownloadSearchError('Radarr', 'Submitting the selected release', cause) });
            logMovieAudioError(`radarr ${download.mediaId} submission`, cause);
          }
          invalidateQueueCache(['radarr-queue']);
        } else {
          const client = createSonarrClient();
          if (!client) { later(job, 'search_failed', 15 * 60_000, 'Sonarr is not configured. Set its URL and API key before retrying.'); continue; }
          operation = 'Reading the requested episodes';
          const episodes = await client.getEpisodes(download.mediaId);
          const selected = episodes.filter((episode) => scopes.some((scope) => episodeMatchesSearchScope(episode, scope)));
          const remaining = selected.filter((episode) => !episode.hasFile);
          const future = remaining.map((episode) => ({ episode, airAt: Date.parse(episode.airDateUtc ?? '') }))
            .filter((item) => item.airAt > Date.now());
          const nextAirAt = future.length ? Math.min(...future.map((item) => item.airAt)) : null;
          updateDownloadSearchJob(job.downloadId, { remainingEpisodeIds: JSON.stringify(remaining.map((episode) => episode.id)), nextAirAt });
          if (selected.length && selected.every((episode) => episode.hasFile)) { later(job, 'complete'); continue; }
          operation = 'Reading the download queue';
          const queue = (await client.getQueue()).records.filter((item) => item.seriesId === download.mediaId);
          const searches = getUnqueuedSonarrSearchScopes(scopes, episodes, queue);
          if (!searches.length) {
            const waitingForAirdate = future.some(({ episode }) => !queue.some((item) => (item.episodeId ?? item.episode?.id) === episode.id)) &&
              !queue.some((item) => !(item.episodeId ?? item.episode?.id));
            if (waitingForAirdate && nextAirAt !== null) {
              updateDownloadSearchJob(job.downloadId, { state: 'waiting_for_airdate', submittedAt: null,
                detail: 'The remaining episodes have not aired yet. Searching resumes automatically after their scheduled airdate.',
                nextAttemptAt: Math.min(nextAirAt + 5_000, Date.now() + 30 * 60_000) });
              continue;
            }
            later(job, queue.length ? 'downloading' : 'needs_selection', 30_000, queue.length ? null :
              'The saved selection does not match any missing episodes in Sonarr. Check the selected episodes and their monitoring settings.'); continue;
          }
          operation = 'Checking the episode search commands';
          const commandStatus = await client.getSeriesSearchStatus(download.mediaId, selected.map((episode) => episode.id), job.submittedAt);
          if (commandStatus.active) {
            updateDownloadSearchJob(job.downloadId, { state: 'searching', submittedAt: job.submittedAt ?? Date.now(), nextAttemptAt: Date.now() + 30_000 });
            continue;
          }
          if (commandStatus.failedCommandIds.length && ['searching', 'downloading'].includes(job.state)) {
            later(job, 'search_failed', 15 * 60_000,
              `Sonarr search command(s) ${commandStatus.failedCommandIds.join(', ')} failed or were cancelled. Check Sonarr logs for the command failure.`);
            continue;
          }
          if (job.submittedAt !== null && ['searching', 'downloading'].includes(job.state)) {
            if (Date.now() - job.submittedAt < 2 * 60_000) { later(job, 'searching'); continue; }
            console.warn(`[downloads] sonarr ${download.mediaId}: scoped search ended without a download`);
            const missing = selected.filter((episode) => !episode.hasFile && searches.some((scope) => episodeMatchesSearchScope(episode, scope))).length;
            const failures = Math.min(5, job.searchFailures + 1);
            updateDownloadSearchJob(job.downloadId, { state: 'waiting_for_release', submittedAt: null, searchFailures: failures,
              nextAttemptAt: Date.now() + Math.min(6 * 60, 30 * 2 ** (failures - 1)) * 60_000,
              detail: `Sonarr finished searching without selecting an eligible release for ${missing} remaining episode(s). ` +
                'The request is still active and will be searched again automatically. Sonarr Interactive Search lists individual release rejection reasons.' });
            continue;
          }
          if (lostLease) break;
          updateDownloadSearchJob(job.downloadId, { state: 'searching', submittedAt: Date.now(), nextAttemptAt: Date.now() + 30_000 });
          // Legacy requests receive a series scope only after an explicit retry.
          operation = 'Submitting the episode search commands';
          for (const scope of searches) {
            if (scope.type === 'series') await client.triggerSearch(download.mediaId);
            else if (scope.type === 'season') await client.triggerSeasonSearch(download.mediaId, scope.seasonNumber);
            else if (scope.type === 'episode') await client.triggerEpisodeSearch([scope.episodeId]);
          }
          invalidateQueueCache(['sonarr-queue']);
        }
      } catch (cause) {
        const current = getDownloadSearchJobs().find((item) => item.downloadId === saved.downloadId);
        const detail = describeDownloadSearchError(download.source === 'radarr' ? 'Radarr' : 'Sonarr', operation, cause);
        if (current?.state === 'grab_pending') updateDownloadSearchJob(saved.downloadId, { detail });
        else later(saved, 'search_failed', 15 * 60_000, detail);
        logMovieAudioError(`${download.source} ${download.mediaId} saved search`, cause);
      } finally {
        if (movieLock) releaseMovieAudioLock(movieLock);
        movieLock = null;
        releaseMovieAudioLock(titleLock); titleLock = null;
      }
    }
  } finally { clearInterval(heartbeat); releaseMovieAudioLock(workerLock); }
}

const workerState = globalThis as typeof globalThis & { queuearrSearchTimer?: ReturnType<typeof setInterval> };
export function startDownloadSearchWorker(): void {
  if (workerState.queuearrSearchTimer || process.env.NEXT_PHASE === 'phase-production-build') return;
  const tick = (): void => { void runDownloadSearchJobs().catch((cause) => logMovieAudioError('saved search worker', cause)); };
  workerState.queuearrSearchTimer = setInterval(tick, 30_000);
  workerState.queuearrSearchTimer.unref();
  tick();
}
