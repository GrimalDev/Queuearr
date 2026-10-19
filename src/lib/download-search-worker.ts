import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { acquireMovieAudioLock, releaseMovieAudioLock, renewMovieAudioLock, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getActiveMonitoredDownloads } from '@/lib/db/monitored-downloads';
import { getDownloadSearchJobs, parseDownloadScopes, recoverDownloadSearchJobs, updateDownloadSearchJob, type DownloadSearchJob } from '@/lib/db/download-search-jobs';
import { logMovieAudioError } from '@/lib/movie-audio-errors';
import { pickBestRelease } from '@/lib/smart-grab';
import { invalidateQueueCache } from '@/lib/queue-cache';

function later(job: DownloadSearchJob, state: string, delay = 30_000): void {
  updateDownloadSearchJob(job.downloadId, { state, nextAttemptAt: Date.now() + delay });
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
      if (!download || !['pending', 'searching', 'grab_pending', 'downloading', 'search_failed'].includes(saved.state) || saved.nextAttemptAt > Date.now()) continue;
      if (download.source !== 'radarr' && download.source !== 'sonarr') continue;
      titleLock = acquireMovieAudioLock(-(download.mediaId * 2 + (download.source === 'sonarr' ? 1 : 0)));
      if (!titleLock) continue;
      try {
        const job = getDownloadSearchJobs().find((item) => item.downloadId === saved.downloadId);
        // Re-read after locking: cancellation or a new request can change the job.
        const current = (await getActiveMonitoredDownloads()).find((item) => item.id === saved.downloadId);
        if (!job || !current || !['pending', 'searching', 'grab_pending', 'downloading', 'search_failed'].includes(job.state)) continue;
        const scopes = parseDownloadScopes(job.scopes);
        if (!scopes.length || scopes.some((scope) => (scope.type === 'movie') !== (download.source === 'radarr'))) {
          later(job, 'needs_selection'); continue;
        }
        if (download.source === 'radarr') {
          // A language request owns its own job and movie locks. Never compete with it.
          if ([...getMovieAudioPolicies().values()].some((policy) => policy.radarrMovieId === download.mediaId)) {
            later(job, 'cancelled'); continue;
          }
          const client = createRadarrClient();
          if (!client) throw new Error('Radarr is not configured.');
          const movie = await client.getMovie(download.mediaId);
          movieLock = acquireMovieAudioLock(movie.tmdbId + 2);
          if (!movieLock) continue;
          if ([...getMovieAudioPolicies().values()].some((policy) => policy.radarrMovieId === download.mediaId)) { later(job, 'cancelled'); continue; }
          if ((await client.getQueue(false)).records.some((item) => item.movieId === download.mediaId)) {
            later(job, job.state === 'pending' ? 'pending' : 'downloading'); continue;
          }
          if (movie.hasFile) { later(job, 'complete'); continue; }
          if (job.state === 'grab_pending') {
            if (Date.now() - (job.submittedAt ?? job.updatedAt) >= 5 * 60_000) {
              console.warn(`[downloads] radarr ${download.mediaId}: submission has no queue entry; review required`);
              later(job, 'needs_review');
            }
            continue;
          }
          if (await client.hasActiveMovieSearch(download.mediaId)) { later(job, 'searching'); continue; }
          const releases = await client.getReleases(download.mediaId);
          const candidate = pickBestRelease(releases);
          if (!candidate) {
            console.warn(`[downloads] radarr ${download.mediaId}: no accepted release`, { returned: releases.length });
            later(job, 'search_failed', 15 * 60_000); continue;
          }
          if (lostLease) break;
          if ((await client.getQueue(false)).records.some((item) => item.movieId === download.mediaId)) { later(job, 'downloading'); continue; }
          if ((await client.getMovie(download.mediaId)).hasFile) { later(job, 'complete'); continue; }
          updateDownloadSearchJob(job.downloadId, { state: 'grab_pending', indexer: candidate.indexer || `Indexer ${candidate.indexerId}`,
            submittedAt: Date.now(), nextAttemptAt: Date.now() + 30_000 });
          try { await client.grabRelease(candidate.guid, candidate.indexerId); }
          catch (cause) { logMovieAudioError(`radarr ${download.mediaId} submission`, cause); }
          invalidateQueueCache(['radarr-queue']);
        } else {
          const client = createSonarrClient();
          if (!client) throw new Error('Sonarr is not configured.');
          if ((await client.getQueue()).records.some((item) => item.seriesId === download.mediaId)) {
            later(job, job.state === 'pending' ? 'pending' : 'downloading'); continue;
          }
          const episodes = await client.getEpisodes(download.mediaId);
          const selected = episodes.filter((episode) => scopes.some((scope) => scope.type === 'series' ||
            scope.type === 'season' && episode.seasonNumber === scope.seasonNumber || scope.type === 'episode' && episode.id === scope.episodeId));
          if (selected.length && selected.every((episode) => episode.hasFile)) { later(job, 'complete'); continue; }
          if (await client.hasActiveSeriesSearch(download.mediaId, episodes.map((episode) => episode.id))) {
            updateDownloadSearchJob(job.downloadId, { state: 'searching', submittedAt: job.submittedAt ?? Date.now(), nextAttemptAt: Date.now() + 30_000 });
            continue;
          }
          if (job.submittedAt !== null && ['searching', 'downloading'].includes(job.state)) {
            if (Date.now() - job.submittedAt < 2 * 60_000) { later(job, 'searching'); continue; }
            console.warn(`[downloads] sonarr ${download.mediaId}: scoped search ended without a download`);
            later(job, 'search_failed', 15 * 60_000); continue;
          }
          if (lostLease) break;
          updateDownloadSearchJob(job.downloadId, { state: 'searching', submittedAt: Date.now(), nextAttemptAt: Date.now() + 30_000 });
          // Only replay selections explicitly saved by the user. Legacy scopes remain blocked.
          for (const scope of scopes) {
            if (scope.type === 'series') await client.triggerSearch(download.mediaId);
            else if (scope.type === 'season') await client.triggerSeasonSearch(download.mediaId, scope.seasonNumber);
            else if (scope.type === 'episode') await client.triggerEpisodeSearch([scope.episodeId]);
          }
          invalidateQueueCache(['sonarr-queue']);
        }
      } catch (cause) {
        const current = getDownloadSearchJobs().find((item) => item.downloadId === saved.downloadId);
        if (current?.state !== 'grab_pending') later(saved, 'search_failed', 15 * 60_000);
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
