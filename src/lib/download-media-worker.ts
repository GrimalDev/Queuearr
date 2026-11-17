import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { createTransmissionClient, type InspectionTorrent } from '@/lib/api/transmission';
import { acquireMovieAudioLock, releaseMovieAudioLock, renewMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getActiveMonitoredDownloads, getLatestMonitoredDownloadBySourceMedia, resetMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getDownloadMediaChecks, saveDownloadMediaCheck, type DownloadMediaCheck } from '@/lib/db/download-media-checks';
import { hasInspectionMount, hasOnlyDescriptiveRequestedAudio, hasUnsafeTorrentFiles, inspectTorrentFile, isMediaFilename, verifiedFilePrefix } from '@/lib/download-media-inspection';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import { rejectedAudioDonors } from '@/lib/movie-audio-attempts';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { TransmissionStatus, type RadarrQueueItem, type SonarrQueueItem } from '@/types';
import { isDescriptiveAudioStream } from '@/lib/audio-description';

const MAX_INSPECTION_MS = 2 * 60_000;
const worker = globalThis as typeof globalThis & { queuearrMediaCheck?: Promise<void>; queuearrMediaCheckTimer?: ReturnType<typeof setInterval> };

function selectedFiles(torrent: InspectionTorrent, source: string, queue: (RadarrQueueItem | SonarrQueueItem)[]): number[] {
  const media = torrent.files.map((file, index) => ({ file, index })).filter(({ file, index }) =>
    torrent.fileStats[index]?.wanted !== false && isMediaFilename(file.name));
  if (source !== 'sonarr' || media.length === 1) return media.map(({ index }) => index);
  return media.filter(({ file }) => {
    const match = /\bS(\d{1,3})E(\d{1,4})\b/i.exec(file.name.replace(/[._-]/g, ' '));
    return match && queue.some((item) => 'episode' in item && item.episode &&
      item.episode.seasonNumber === Number(match[1]) && item.episode.episodeNumber === Number(match[2]));
  }).map(({ index }) => index);
}

async function checkDownloads(): Promise<void> {
  const transmission = createTransmissionClient();
  if (!transmission) return;
  const lease = acquireMovieAudioLock(-9_000_000_001);
  if (!lease) return;
  let lost = false;
  const heartbeat = setInterval(() => { try { lost = !renewMovieAudioLock(lease); } catch { lost = true; } }, 30_000);
  try {
    const radarr = createRadarrClient(), sonarr = createSonarrClient();
    const [movies, episodes, torrents, incomplete] = await Promise.all([
      radarr?.getQueue().then((queue) => queue.records).catch(() => null) ?? null,
      sonarr?.getQueue().then((queue) => queue.records).catch(() => null) ?? null,
      transmission.getInspectionTorrents(), transmission.getIncompleteDirectory().catch(() => undefined),
    ]);
    // Restore only changes this worker persisted before making them, including after restart/cancellation.
    for (const saved of getDownloadMediaChecks().filter((row) => row.sequentialChanged || row.speedChanged)) {
      const torrent = torrents.find((item) => item.hashString.toLowerCase() === saved.hash);
      if (torrent && Date.now() - saved.startedAt < MAX_INSPECTION_MS && saved.state === 'checking') continue;
      if (torrent && saved.sequentialChanged) await transmission.setSequentialDownload(saved.hash, false);
      if (torrent && saved.speedChanged) await transmission.setInspectionSpeedLimit(saved.hash, saved.previousLimit, saved.previousLimited);
      saveDownloadMediaCheck({ ...saved, sequentialChanged: false, speedChanged: false, updatedAt: Date.now() });
    }
    let inspected = 0;
    const batchStartedAt = Date.now();
    const savedChecks = getDownloadMediaChecks();
    const policies = getMovieAudioPolicies();
    for (const download of await getActiveMonitoredDownloads()) {
      if (lost || inspected >= 4 || Date.now() - batchStartedAt >= 30_000) break;
      if (!['radarr', 'sonarr'].includes(download.source) || ['cancelled', 'cancelling'].includes(download.lastStatus ?? '')) continue;
      const source = download.source as 'radarr' | 'sonarr';
      const snapshot = source === 'radarr' ? movies : episodes;
      if (!snapshot) continue;
      const queue = snapshot.filter((item) => ('movieId' in item ? item.movieId : 'seriesId' in item ? item.seriesId : undefined) === download.mediaId);
      const policy = source === 'radarr' ? [...policies.values()].find((item) => item.radarrMovieId === download.mediaId) : undefined;
      const audioJob = policy ? getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId) : undefined;
      const hashes = new Set(queue.map((item) => item.downloadId?.toLowerCase()).filter((hash): hash is string => !!hash));
      if (audioJob?.donorHash && audioJob.state === 'downloading') hashes.add(audioJob.donorHash.toLowerCase());
      for (const hash of hashes) {
        if (lost || inspected >= 4 || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(hash)) break;
        const torrent = torrents.find((item) => item.hashString.toLowerCase() === hash);
        const matching = queue.filter((item) => item.downloadId?.toLowerCase() === hash);
        const allOwners = [...(movies ?? []), ...(episodes ?? [])].filter((item) => item.downloadId?.toLowerCase() === hash);
        // Shared transfers, cancelled requests, active imports and uncertain publication are never modified.
        if (!torrent || matching.some(isImportInProgress) || allOwners.length !== matching.length ||
            audioJob && (audioJob.outputPath || audioJob.restoreMonitored !== null || audioJob.replaceDonor ||
              ['cancelled', 'cancelling', 'needs_review', 'validating', 'merging', 'replacing', 'verifying', 'available'].includes(audioJob.state))) continue;
        const required = policy?.requiredLanguages ?? matching.flatMap((item) => item.languages?.slice(0, 1) ?? []);
        const languageScope = [...new Set(required.map((language) => language.id))].sort((left, right) => left - right).join(',');
        const key = `${download.id}:${download.createdAt}:${hash}:${languageScope}`;
        const prior = savedChecks.find((row) => row.key === key);
        if (prior && ['retrying', 'no_description_marked', 'description_included'].includes(prior.state)) continue;
        if (prior?.state === 'unverified' && (torrent.percentDone < 1 || Date.now() - prior.updatedAt < 15 * 60_000)) continue;
        if (torrent.status !== TransmissionStatus.DOWNLOAD && torrent.percentDone < 1) continue;
        if (torrent.metadataPercentComplete < 1 || !torrent.files.length) continue;
        const requestLock = acquireMovieAudioLock(-(download.mediaId * 2 + (source === 'sonarr' ? 1 : 0)));
        if (!requestLock) continue;
        const audioLock = policy ? acquireMovieAudioLock(policy.tmdbId + 2) : undefined;
        if (policy && !audioLock) { releaseMovieAudioLock(requestLock); continue; }
        try {
          const fresh = await getLatestMonitoredDownloadBySourceMedia(source, download.mediaId);
          if (!fresh || fresh.createdAt !== download.createdAt || fresh.completedAt !== null || ['cancelled', 'cancelling'].includes(fresh.lastStatus ?? '')) continue;
          if (policy) {
            const freshPolicy = getMovieAudioPolicies().get(policy.tmdbId);
            const freshAudio = getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId);
            if (!freshPolicy || JSON.stringify(freshPolicy.requiredLanguages) !== JSON.stringify(policy.requiredLanguages) ||
                !freshAudio || freshAudio.updatedAt !== audioJob?.updatedAt) continue;
            if (audioJob?.donorHash?.toLowerCase() === hash && (torrent.labels?.length !== 1 ||
                torrent.labels[0] !== `queuearr-audio-${policy.tmdbId}-${audioJob.donorLanguageId}` ||
                torrent.downloadDir !== `/data/queuearr-audio/${policy.tmdbId}-${audioJob.donorLanguageId}`)) continue;
          }
          inspected++;
          let row: DownloadMediaCheck = prior ?? { key, downloadId: download.id, cycleStartedAt: download.createdAt, hash,
            state: 'checking', detail: 'Checking filenames and audio tracks.', startedAt: Date.now(), checkedBytes: 0,
            sequentialChanged: false, speedChanged: false, previousLimit: 0, previousLimited: false, updatedAt: Date.now() };
          const unsafe = prior?.state === 'unsafe_files' || hasUnsafeTorrentFiles(torrent.files);
          if (!unsafe && prior?.state !== 'description_only' && !await hasInspectionMount(torrent)) {
            saveDownloadMediaCheck({ ...row, state: 'unverified', detail: 'The shared download folder is unavailable for audio inspection.', updatedAt: Date.now() });
            continue;
          }
          const files = selectedFiles(torrent, source, matching);
          let rejected = unsafe || prior?.state === 'description_only';
          let descriptionIncluded = false;
          let allChecked = files.length > 0 && files.length <= 8;
          const bytes = files.reduce((sum, index) => sum + verifiedFilePrefix(torrent, index), 0);
          const expired = Date.now() - row.startedAt >= MAX_INSPECTION_MS;
          if (!rejected && !expired && !row.speedChanged && torrent.percentDone < 1 &&
              Number.isSafeInteger(torrent.downloadLimit) && typeof torrent.downloadLimited === 'boolean' &&
              (!torrent.downloadLimited || torrent.downloadLimit! > 128)) {
            row = { ...row, speedChanged: true, previousLimit: torrent.downloadLimit!, previousLimited: torrent.downloadLimited }; saveDownloadMediaCheck(row);
            await transmission.setInspectionSpeedLimit(hash, 128, true);
          }
          if (!rejected && !expired && torrent.percentDone < 1 && torrent.sequential_download === false) {
            // Reserve before RPC so a crash cannot leave an unrecorded temporary setting.
            row = { ...row, sequentialChanged: true }; saveDownloadMediaCheck(row);
            await transmission.setSequentialDownload(hash, true);
          }
          if (!rejected && (bytes > row.checkedBytes || torrent.percentDone === 1)) {
            for (const index of files.slice(0, 8)) {
              if (Date.now() - batchStartedAt >= 30_000) { allChecked = false; break; }
              const streams = await inspectTorrentFile(torrent, index, incomplete);
              if (!streams) { allChecked = false; continue; }
              descriptionIncluded ||= streams.some((stream) => stream.codec_type === 'audio' && isDescriptiveAudioStream(stream));
              if (hasOnlyDescriptiveRequestedAudio(streams, required)) { rejected = true; break; }
            }
          } else allChecked = false;
          if (lost || !renewMovieAudioLock(requestLock) || audioLock && !renewMovieAudioLock(audioLock)) continue;
          if (rejected && matching.length) {
            const client = source === 'radarr' ? radarr : sonarr;
            const current = client && (await client.getQueue()).records.filter((item) => item.downloadId?.toLowerCase() === hash);
            if (!current?.length || current.some(isImportInProgress)) continue;
            if (source === 'sonarr' && sonarr) {
              const affected = matching.flatMap((item) => 'episodeId' in item && item.episodeId ? [item.episodeId] : []);
              if (!affected.length || (await sonarr.getEpisodes(download.mediaId)).some((episode) => affected.includes(episode.id) && episode.hasFile)) continue;
            } else if (radarr) {
              const movie = await radarr.getMovie(download.mediaId);
              const oldFile = 'movie' in matching[0] ? matching[0].movie?.movieFile?.id : undefined;
              if (movie.hasFile && (!oldFile || movie.movieFile?.id !== oldFile)) continue;
            }
          }
          row = { ...row, checkedBytes: bytes, updatedAt: Date.now(),
            state: rejected ? unsafe ? 'unsafe_files' : 'description_only' : allChecked ? descriptionIncluded ? 'description_included' : 'no_description_marked' : expired || torrent.percentDone === 1 ? 'unverified' : 'checking',
            detail: rejected ? unsafe ? 'Found potentially dangerous files in the selected torrent.' : 'The requested language is only available as audio description.' :
              allChecked ? descriptionIncluded ? 'Audio description is present; no requested language was identified as description-only.' :
                'No audio-description marker was found on the requested audio. Unlabelled descriptive audio cannot be ruled out.' : 'Audio type could not be verified from the available file data.' };
          saveDownloadMediaCheck(row);
          if (rejected) await transmission.pauseTorrent(hash);
          if (row.state !== 'checking' && (row.sequentialChanged || row.speedChanged)) {
            if (row.sequentialChanged) await transmission.setSequentialDownload(hash, false);
            if (row.speedChanged) await transmission.setInspectionSpeedLimit(hash, row.previousLimit, row.previousLimited);
            row = { ...row, sequentialChanged: false, speedChanged: false }; saveDownloadMediaCheck(row);
          }
          if (rejected) {
            // Never delete media or resume manually paused torrents. Existing retry rules own normal Arr downloads.
            if (policy && audioJob?.donorHash?.toLowerCase() === hash) {
              const rejectedDonors = rejectedAudioDonors(audioJob.rejectedDonors);
              rejectedDonors.add(`hash:${hash}`);
              if (audioJob.donorReleaseKey) rejectedDonors.add(audioJob.donorReleaseKey);
              updateMovieAudioJob(policy.tmdbId, { donorHash: null, donorLanguageId: null, donorReleaseKey: null, donorMetadata: null,
                donorIndexer: null, estimatedLanguages: '[]', audioDescription: false, rejectedDonors: JSON.stringify([...rejectedDonors]),
                state: 'pending', detail: 'Searching for another release after the audio/file check.', nextAttemptAt: Date.now() + 30_000 });
              await resetMonitoredDownload(download.id, unsafe ? 'suspicious_files' : 'audio_description');
              saveDownloadMediaCheck({ ...row, state: 'retrying' });
            }
            invalidateQueueCache();
          }
        } catch { console.warn(`[downloads] Audio inspection deferred for ${source} ${download.mediaId}.`); }
        finally { if (audioLock) releaseMovieAudioLock(audioLock); releaseMovieAudioLock(requestLock); }
      }
    }
  } finally { clearInterval(heartbeat); releaseMovieAudioLock(lease); }
}

export function runDownloadMediaChecks(): Promise<void> {
  if (!worker.queuearrMediaCheck) worker.queuearrMediaCheck = checkDownloads().finally(() => { worker.queuearrMediaCheck = undefined; });
  return worker.queuearrMediaCheck;
}

export function startDownloadMediaChecks(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || worker.queuearrMediaCheckTimer) return;
  const tick = (): void => { void runDownloadMediaChecks().catch(() => console.warn('[downloads] Audio/file inspection is temporarily unavailable.')); };
  worker.queuearrMediaCheckTimer = setInterval(tick, 10_000);
  worker.queuearrMediaCheckTimer.unref(); tick();
}
