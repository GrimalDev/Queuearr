import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { createTransmissionClient } from '@/lib/api/transmission';
import { getActiveMonitoredDownloads } from '@/lib/db/monitored-downloads';
import { getDownloadSearchJobs, parseDownloadScopes } from '@/lib/db/download-search-jobs';
import { getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { clearSettledAutomaticDownloadRetries, getAutomaticDownloadRetry, observeAutomaticDownloadFailures } from '@/lib/db/automatic-download-retries';
import { DownloadRetryError, getDownloadRetryTimes } from '@/lib/download-retry';
import { retryAudioAlternative, retryDownloadSearch, retryRadarrQueue, retrySonarrQueue } from '@/lib/download-retry-actions';
import { automaticRetryAt, automaticSearchRetryKey, getDownloadFileFailureReason, isAutomaticRetryFailure } from '@/lib/automatic-retry-policy';
import { logMovieAudioError } from '@/lib/movie-audio-errors';
import { sonarrQueueItemMatchesScope } from '@/lib/sonarr-search-scopes';

const INTERVAL_MS = 60_000;
const worker = globalThis as typeof globalThis & {
  queuearrAutomaticRetry?: Promise<void>;
  queuearrAutomaticRetryTimer?: ReturnType<typeof setInterval>;
};

async function retryFailedDownloads(): Promise<void> {
  clearSettledAutomaticDownloadRetries();
  const radarr = createRadarrClient();
  const sonarr = createSonarrClient();
  const transmission = createTransmissionClient();
  // An unavailable service is not evidence of a failed download or recovery.
  const [movies, series, torrents] = await Promise.all([
    radarr?.getQueue(false).then((queue) => queue.records).catch(() => null) ?? null,
    sonarr?.getQueue().then((queue) => queue.records).catch(() => null) ?? null,
    transmission?.getTorrents().catch(() => null) ?? null,
  ]);
  const searchJobs = getDownloadSearchJobs();
  const policies = [...getMovieAudioPolicies().values()];
  const audioJobs = getMovieAudioJobs();
  const deadlines = getDownloadRetryTimes();
  for (const download of await getActiveMonitoredDownloads()) {
    const source = download.source;
    if (source !== 'radarr' && source !== 'sonarr') continue;
    const snapshot = source === 'radarr' ? movies : series;
    if (snapshot === null) continue;
    const deadline = deadlines.get(`${source}:${download.mediaId}`);
    if (deadline == null) continue;
    const candidates: { key: string; retry: (key: string) => Promise<number> }[] = [];
    if (!['cancelled', 'cancelling'].includes(download.lastStatus ?? '')) {
      const policy = source === 'radarr' ? policies.find((item) => item.radarrMovieId === download.mediaId) : undefined;
      const audio = policy ? audioJobs.find((item) => item.tmdbId === policy.tmdbId) : undefined;
      // Never automate review, publication, restoration, or an uncertain submission.
      const protectedAudio = audio && (audio.outputPath || audio.restoreMonitored !== null || audio.replaceDonor ||
        ['needs_review', 'validating', 'merging', 'replacing', 'verifying', 'grab_pending', 'available', 'cancelled', 'cancelling'].includes(audio.state));
      if (!protectedAudio) {
        if (audio?.donorHash) {
          if (torrents === null) continue;
          const torrent = torrents.find((item) => item.hashString.toLowerCase() === audio.donorHash!.toLowerCase());
          if (audio.donorLanguageId && ['pending', 'downloading', 'waiting_for_configuration'].includes(audio.state) &&
              torrent && torrent.percentDone < 1 && (torrent.error > 0 || audio.state === 'waiting_for_configuration')) {
            candidates.push({ key: `${download.id}:audio:${audio.donorHash.toLowerCase()}`,
              retry: (automaticKey) => retryAudioAlternative(audio.tmdbId, { automaticKey }) });
          }
        } else {
          const items = source === 'radarr' ? movies!.filter((item) => item.movieId === download.mediaId)
            : series!.filter((item) => item.seriesId === download.mediaId);
          const search = searchJobs.find((item) => item.downloadId === download.id);
          const scopes = source === 'sonarr' && search ? parseDownloadScopes(search.scopes) : [];
          const failed = source === 'sonarr' && scopes.length
            ? series!.filter((item) => item.seriesId === download.mediaId && isAutomaticRetryFailure(item) &&
              scopes.some((scope) => sonarrQueueItemMatchesScope(item, scope))) : items.filter(isAutomaticRetryFailure);
          const transfers = new Set<string>();
          // Prioritize unusable files when choosing this title's next replacement search.
          for (const item of failed.sort((a, b) => Number(!!getDownloadFileFailureReason(b)) - Number(!!getDownloadFileFailureReason(a)))) {
            const transfer = item.downloadId?.toLowerCase() || String(item.id);
            if (transfers.has(transfer)) continue;
            transfers.add(transfer);
            candidates.push({ key: `${download.id}:queue:${transfer}`,
              retry: (automaticKey) => source === 'radarr' ? retryRadarrQueue(download.mediaId, [item.id], { automaticKey })
                : retrySonarrQueue(download.mediaId, [item.id], { automaticKey }) });
          }
          const failedSearch = audio ? ['search_failed', 'waiting_for_configuration'].includes(audio.state)
            : search?.state === 'search_failed';
          if (!items.length && failedSearch) candidates.push({ key: automaticSearchRetryKey(download.id, audio?.updatedAt ?? search?.submittedAt ?? search?.updatedAt ?? 0),
            retry: (automaticKey) => retryDownloadSearch(source, download.mediaId, { automaticKey }) });
        }
      }
    }
    observeAutomaticDownloadFailures(download.id, candidates.map((item) => item.key), deadline);
    for (const candidate of candidates) {
      const failure = getAutomaticDownloadRetry(candidate.key);
      if (!failure || Date.now() < automaticRetryAt(failure.failedAt, failure.retryDeadline)) continue;
      try {
        await candidate.retry(candidate.key);
        console.info(`[downloads] Automatic retry started for ${source} ${download.mediaId}.`);
        break;
      } catch (cause) {
        if (cause instanceof DownloadRetryError) console.info(`[downloads] Automatic retry deferred for ${source} ${download.mediaId}: ${cause.message}`);
        else logMovieAudioError(`automatic retry ${source} ${download.mediaId}`, cause);
      }
    }
  }
}

export function runAutomaticDownloadRetries(): Promise<void> {
  if (!worker.queuearrAutomaticRetry) {
    worker.queuearrAutomaticRetry = retryFailedDownloads().finally(() => { worker.queuearrAutomaticRetry = undefined; });
  }
  return worker.queuearrAutomaticRetry;
}

export function startAutomaticDownloadRetries(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || worker.queuearrAutomaticRetryTimer) return;
  const tick = (): void => { void runAutomaticDownloadRetries().catch((cause) => logMovieAudioError('automatic download retry job', cause)); };
  worker.queuearrAutomaticRetryTimer = setInterval(tick, INTERVAL_MS);
  worker.queuearrAutomaticRetryTimer.unref();
  tick();
}
