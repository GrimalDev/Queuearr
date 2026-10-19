import { AudioConfigurationError, logMovieAudioError } from '@/lib/movie-audio-errors';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createRadarrClient, type RadarrClient } from '@/lib/api/radarr';
import { createTransmissionClient } from '@/lib/api/transmission';
import {
  acquireMovieAudioLock, releaseMovieAudioLock, renewMovieAudioLock, getMovieAudioJobs,
  getMovieAudioPolicies, saveMovieAudioPolicy, updateMovieAudioJob, type MovieAudioJob, type MovieAudioPolicy,
} from '@/lib/db/movie-audio';
import { AudioProfileError, ensureAudioProfile } from '@/lib/radarr-audio-profile';
import { getAvailableAudio, hasRequiredAudio, normalizeMovieAudioPolicy } from '@/lib/movie-audio-policy';
import { AudioReviewError, confinedFile, containsAudioLanguages, isInside, languageCodes, prepareAudioMerge, prepareMovieReplacement, verifyAudio } from '@/lib/movie-audio-media';
import { canReplaceFromDonor, donorMetadata, isAudioDonor, isMovieRegrab, publishedDonorQuality } from '@/lib/movie-audio-releases';
import { rememberDownloadTransfer } from '@/lib/db/download-transfers';
import { getMovieAudioTorrentSource } from '@/lib/movie-audio-download';
import { audioReleaseKey, isRejectedAudioRelease, rejectedAudioDonors } from '@/lib/movie-audio-attempts';
import { pickBestRelease } from '@/lib/smart-grab';
import { isMovieInCinemas, IN_CINEMAS_SEARCH_MESSAGE } from '@/lib/movie-release-status';
import type { Release } from '@/types';

interface AudioPaths { library: string; donors: string; backups: string }
const AUDIO_PATHS: AudioPaths = {
  library: '/movies',
  donors: '/data/queuearr-audio',
  backups: '/audio-backups',
};
async function audioPaths(): Promise<AudioPaths> {
  const paths = await Promise.all([AUDIO_PATHS.library, AUDIO_PATHS.donors, AUDIO_PATHS.backups].map((path) => realpath(path)));
  if (paths.some((path, i) => paths.some((other, j) => i !== j && (path === other || isInside(path, other))))) {
    throw new AudioReviewError('Audio library, donor and backup folders must be separate, non-nested folders.');
  }
  return { library: paths[0], donors: paths[1], backups: paths[2] };
}
function later(tmdbId: number, detail: string, state = 'pending', delay = 15 * 60_000): void {
  updateMovieAudioJob(tmdbId, { state, detail, nextAttemptAt: Date.now() + delay });
}
async function noImport(client: RadarrClient, movieId: number): Promise<void> {
  if ((await client.getQueue(false)).records.some((item) => item.movieId === movieId)) {
    throw new AudioReviewError('Radarr has a download or import in progress for this movie. Review it before merging.');
  }
}
async function restoreMonitoring(client: RadarrClient, policy: MovieAudioPolicy, value: boolean): Promise<void> {
  const current = await client.getMovie(policy.radarrMovieId);
  await client.updateMovie({ ...current, monitored: value });
  updateMovieAudioJob(policy.tmdbId, { restoreMonitored: null });
}

async function processJob(
  client: RadarrClient, policy: MovieAudioPolicy, job: MovieAudioJob, signal: AbortSignal,
): Promise<void> {
  const id = policy.tmdbId;
  // A previous process may have died between disabling monitoring and publishing.
  if (job.restoreMonitored !== null) {
    await restoreMonitoring(client, policy, job.restoreMonitored);
    const detail = 'A merge was interrupted. Review the library files and backup before retrying.';
    logMovieAudioError(`movie ${id}`, undefined, detail);
    later(id, detail, 'needs_review');
    return;
  }
  if (job.state === 'needs_review') return;
  if (job.replaceDonor) {
    if (job.outputPath || job.restoreMonitored !== null || !job.donorHash || !job.donorLanguageId) {
      throw new AudioReviewError('The audio donor cannot be replaced during publication.');
    }
    const transmission = createTransmissionClient();
    if (!transmission) throw new AudioConfigurationError('Transmission must be configured to switch audio releases.');
    const donor = (await transmission.getAudioDonors()).find((torrent) => torrent.hashString.toLowerCase() === job.donorHash!.toLowerCase());
    if (!donor || donor.labels?.length !== 1 || donor.labels[0] !== `queuearr-audio-${id}-${job.donorLanguageId}` ||
        donor.downloadDir !== join(AUDIO_PATHS.donors, `${id}-${job.donorLanguageId}`)) {
      throw new AudioReviewError('The previous audio donor is missing or no longer isolated. Review it before switching releases.');
    }
    if (donor.percentDone >= 1) {
      // It may finish between the click and this tick. Keep it for validation instead of discarding it.
      const rejected = rejectedAudioDonors(job.rejectedDonors);
      rejected.delete(`hash:${donor.hashString.toLowerCase()}`);
      if (job.donorReleaseKey) rejected.delete(job.donorReleaseKey);
      updateMovieAudioJob(id, { replaceDonor: false, rejectedDonors: JSON.stringify([...rejected]),
        state: 'downloading', detail: 'The audio download completed. Waiting for audio checks.', nextAttemptAt: 0 });
      return;
    }
    await transmission.pauseTorrent(donor.hashString);
    // Keep the old torrent and its data. A crash before this write safely repeats the pause.
    const replacement = { donorHash: null, donorLanguageId: null, donorIndexer: null, donorReleaseKey: null, donorMetadata: null, estimatedLanguages: '[]',
      replaceDonor: false, state: 'pending', detail: 'Searching for another audio release.', nextAttemptAt: 0 };
    updateMovieAudioJob(id, replacement);
    job = { ...job, ...replacement };
  }
  let movie = await client.getMovie(policy.radarrMovieId);
  if (movie.tmdbId !== id) throw new AudioReviewError('The Radarr movie no longer matches this request.');
  const requestedPolicy = normalizeMovieAudioPolicy(policy, movie);
  if (requestedPolicy !== policy) {
    policy = requestedPolicy;
    saveMovieAudioPolicy(policy);
  }
  if (job.regrabFileId !== null) {
    const downloading = (await client.getQueue(false)).records.some((item) => item.movieId === movie.id);
    if (downloading && (!movie.hasFile || movie.movieFile?.id === job.regrabFileId)) {
      later(id, 'Radarr is downloading or importing the replacement movie.', 'regrabbing', 30_000);
      return;
    }
    if (!movie.hasFile || !movie.movieFile?.id || movie.movieFile.id === job.regrabFileId) {
      if (job.regrabRequestedAt !== null && Date.now() - job.regrabRequestedAt > 45 * 60_000) {
        throw new AudioReviewError('Radarr has not imported a replacement movie. Review its download history before retrying.');
      }
      later(id, 'Waiting for Radarr to import the regrab. The previous file does not complete this request.', 'regrabbing', 30_000);
      return;
    }
    updateMovieAudioJob(id, { regrabFileId: null, regrabRequestedAt: null });
  }
  if (movie.hasFile && (getAvailableAudio(movie).length === 0 || movie.movieFile?.languages?.some((language) => language.id <= 0))) {
    throw new AudioReviewError('Analyze the existing movie in Radarr to identify every audio language first.');
  }
  const profiles = await client.getQualityProfiles();
  const base = profiles.find((profile) => profile.id === policy.baseProfileId);
  if (!base) throw new AudioReviewError('The original Radarr quality profile was removed.');
  const configLock = acquireMovieAudioLock();
  if (!configLock) return;
  try {
    const profile = await ensureAudioProfile(client, base, movie.hasFile ? policy.requiredLanguages : [policy.requiredLanguages[0]]);
    if (movie.qualityProfileId !== profile.id) movie = await client.updateMovie({ ...movie, qualityProfileId: profile.id });
  } finally { releaseMovieAudioLock(configLock); }
  if (hasRequiredAudio(movie, policy.requiredLanguages)) {
    if (job.outputPath) {
      if (movie.movieFile?.path !== job.outputPath) throw new AudioReviewError('Radarr has not imported the merged file. Review its rescan results.');
      const paths = await audioPaths();
      await verifyAudio(await confinedFile(paths.library, job.outputPath), policy.requiredLanguages, signal);
      const quality = publishedDonorQuality(job.donorMetadata);
      if (quality) {
        await noImport(client, policy.radarrMovieId);
        if (!movie.movieFile?.id || !await client.updateMovieFileQuality(movie.movieFile.id, job.outputPath, quality)) {
          throw new AudioReviewError('Radarr changed the replacement file before its quality could be confirmed.');
        }
      }
    }
    updateMovieAudioJob(id, { state: 'available', detail: 'All requested audio languages are available.', outputPath: null, donorHash: null, donorLanguageId: null, donorReleaseKey: null, rejectedDonors: '[]', replaceDonor: false });
    return;
  }
  if (job.outputPath) {
    const mergedLanguage = policy.requiredLanguages.find((language) => language.id === job.donorLanguageId);
    if (movie.movieFile?.path === job.outputPath && mergedLanguage && hasRequiredAudio(movie, [mergedLanguage])) {
      const paths = await audioPaths();
      await verifyAudio(await confinedFile(paths.library, job.outputPath), getAvailableAudio(movie), signal);
      updateMovieAudioJob(id, { outputPath: null, donorHash: null, donorLanguageId: null, donorIndexer: null, donorReleaseKey: null, rejectedDonors: '[]', state: 'pending', nextAttemptAt: 0 });
      return;
    }
    const mergedFile = await confinedFile((await audioPaths()).library, job.outputPath);
    if (mergedLanguage) await verifyAudio(mergedFile, [mergedLanguage], signal);
    await client.rescanMovie(policy.radarrMovieId);
    later(id, 'Waiting for Radarr to recognize the merged audio. Review its rescan if this persists.', 'verifying', 60_000);
    return;
  }
  if ((await client.getQueue(false)).records.some((item) => item.movieId === movie.id)) {
    later(id, 'Radarr is downloading or importing a release.', 'downloading', 60_000);
    return;
  }
  if (!movie.hasFile) {
    if (job.state === 'grab_pending') {
      // A lost grab response must not submit the same or another release again.
      if (Date.now() - job.updatedAt < 5 * 60_000) return;
      throw new AudioReviewError('Radarr did not expose a download within five minutes of the grab. Review its download client and history before retrying.');
    }
    if (await client.hasActiveMovieSearch(policy.radarrMovieId)) {
      later(id, 'Radarr is searching for the initial movie release.', 'pending', 30_000);
      return;
    }
    const releases = await client.getReleases(policy.radarrMovieId);
    const candidate = pickBestRelease(releases);
    if (!candidate) {
      // Log decisions without titles, signed URLs, or raw rejection strings.
      const reasons = releases.flatMap((release) => release.rejections ?? []);
      console.warn(`[audio] movie ${id}: initial release search found no eligible release`, {
        returned: releases.length,
        rejected: releases.filter((release) => release.downloadAllowed === false || release.rejections?.length).length,
        quality: reasons.filter((reason) => /quality|profile|wanted/i.test(reason)).length,
        language: reasons.filter((reason) => /language|audio/i.test(reason)).length,
        customFormat: reasons.filter((reason) => /custom format|score/i.test(reason)).length,
        blocklisted: reasons.filter((reason) => /blocklist/i.test(reason)).length,
      });
      const inCinemas = isMovieInCinemas(movie);
      later(id, inCinemas ? IN_CINEMAS_SEARCH_MESSAGE : 'No eligible initial movie release was returned by Radarr.',
        inCinemas ? 'in_cinemas' : 'search_failed');
      return;
    }
    const indexer = candidate.indexer || `Indexer ${candidate.indexerId}`;
    console.info(`[audio] movie ${id}: submitting an accepted initial release`, {
      returned: releases.length, indexerId: candidate.indexerId, seeders: candidate.seeders ?? 0,
    });
    // Reserve before the external call. Keep this state even if its response is lost.
    updateMovieAudioJob(id, { state: 'grab_pending', donorIndexer: indexer, estimatedLanguages: JSON.stringify(candidate.languages ?? []),
      detail: 'Release sent to Radarr. Waiting for the download client.', nextAttemptAt: Date.now() + 30_000 });
    try { await client.grabRelease(candidate.guid, candidate.indexerId); }
    catch (error) { logMovieAudioError(`movie ${id} initial release submission`, error); }
    return;
  }
  const missing = policy.requiredLanguages.filter((language) => !getAvailableAudio(movie).some((item) => item.id === language.id));
  const wanted = job.donorLanguageId ? missing.find((language) => language.id === job.donorLanguageId) : missing[0];
  if (!wanted) {
    updateMovieAudioJob(id, { donorHash: null, donorLanguageId: null, donorIndexer: null, nextAttemptAt: 0 });
    return;
  }
  let releases: Release[] = [];
  const rejected = rejectedAudioDonors(job.rejectedDonors ?? '[]');
  if (!job.donorHash || job.state === 'pending') {
    if (await client.hasActiveMovieSearch(policy.radarrMovieId)) {
      later(id, 'Waiting for the current Radarr movie search before choosing a full replacement.', 'pending', 30_000);
      return;
    }
    console.info(`[audio] movie ${id}: searching for a complete multilingual replacement`, {
      requiredLanguageIds: policy.requiredLanguages.map((language) => language.id),
    });
    releases = await client.getReleases(policy.radarrMovieId);
    // Radarr returns decisions in its quality/profile preference order.
    // Reject individual previous sources, without excluding every full replacement on retry.
    const excluded = new Set(rejected);
    if (job.donorHash) excluded.add(`hash:${job.donorHash.toLowerCase()}`);
    if (job.donorReleaseKey) excluded.add(job.donorReleaseKey);
    const complete = movie.movieFile?.id && releases.find((release) =>
      !isRejectedAudioRelease(release, excluded) && isMovieRegrab(release, movie, policy.requiredLanguages, base));
    if (complete) {
      // An external Radarr action may have imported or queued a file during the search.
      const current = await client.getMovie(policy.radarrMovieId);
      if (current.movieFile?.id !== movie.movieFile?.id || current.movieFile?.path !== movie.movieFile?.path) {
        later(id, 'The library file changed during replacement search. Checking it again.', 'pending', 30_000);
        return;
      }
      if ((await client.getQueue(false)).records.some((item) => item.movieId === movie.id)) {
        later(id, 'Radarr is downloading or importing a release.', 'downloading', 30_000);
        return;
      }
      if (signal.aborted) throw new AudioReviewError('The audio worker lost its processing lock.');
      if (job.donorHash) {
        const transmission = createTransmissionClient();
        const donor = transmission && (await transmission.getAudioDonors()).find((torrent) =>
          torrent.hashString.toLowerCase() === job.donorHash!.toLowerCase());
        if (!donor || !job.donorLanguageId || donor.labels?.length !== 1 ||
            donor.labels[0] !== `queuearr-audio-${id}-${job.donorLanguageId}` ||
            donor.downloadDir !== join(AUDIO_PATHS.donors, `${id}-${job.donorLanguageId}`)) {
          throw new AudioReviewError('The previous audio donor is missing or no longer isolated. Review it before replacing the movie.');
        }
        // Keep complete donors seeding and retain all data. Only pause an unfinished donor.
        if (donor.percentDone < 1) await transmission!.pauseTorrent(donor.hashString);
        rememberDownloadTransfer('radarr', policy.radarrMovieId, donor.hashString);
      }
      updateMovieAudioJob(id, { state: 'regrabbing', regrabFileId: movie.movieFile!.id, regrabRequestedAt: Date.now(),
        donorHash: null, donorLanguageId: null, donorReleaseKey: null, donorMetadata: null, replaceDonor: false,
        donorIndexer: complete.indexer || `Indexer ${complete.indexerId}`, estimatedLanguages: JSON.stringify(complete.languages ?? []),
        detail: 'Downloading a complete movie with all requested audio.', nextAttemptAt: Date.now() + 30_000 });
      console.info(`[audio] movie ${id}: submitting a complete multilingual replacement`, { indexerId: complete.indexerId });
      try { await client.grabRelease(complete.guid, complete.indexerId); }
      catch (cause) { logMovieAudioError(`movie ${id} multilingual replacement submission`, cause); }
      return;
    }
    console.info(`[audio] movie ${id}: no eligible full replacement; using the audio donor fallback`, { returned: releases.length });
  }
  if (!job.donorHash) updateMovieAudioJob(id, { donorLanguageId: wanted.id, detail: `Searching for compatible ${wanted.name} audio as a fallback.` });
  languageCodes(wanted);
  const paths = await audioPaths();
  const transmission = createTransmissionClient();
  if (!transmission) throw new AudioConfigurationError('Transmission must be configured to download additional audio.');
  if (!await transmission.supportsAudioDonors()) {
    throw new AudioConfigurationError('The configured Transmission endpoint did not report version 4 or newer. Check TRANSMISSION_URL and the daemon version.');
  }
  const isolationIssue = await client.getAudioDonorIsolationIssue();
  if (isolationIssue) throw new AudioConfigurationError(isolationIssue);
  // Must be the same absolute path in Queuearr and Transmission, without symlink aliases.
  const downloadDir = join(AUDIO_PATHS.donors, `${id}-${wanted.id}`);
  await mkdir(downloadDir, { recursive: true });
  if (!isInside(paths.donors, await realpath(downloadDir))) throw new AudioReviewError('The donor directory escapes the configured folder.');
  const label = `queuearr-audio-${id}-${wanted.id}`;
  const torrents = await transmission.getAudioDonors();
  const donor = torrents.find((torrent) => !rejected.has(`hash:${torrent.hashString.toLowerCase()}`) &&
    torrent.labels?.length === 1 && torrent.labels[0] === label && torrent.downloadDir === downloadDir &&
    (!job.donorHash || torrent.hashString.toLowerCase() === job.donorHash.toLowerCase()));
  if (!donor) {
    if (job.donorHash) throw new AudioReviewError('The tracked audio torrent is missing or its folder/label changed.');
    const candidate = releases.find((release) => !isRejectedAudioRelease(release, rejected) && isAudioDonor(release, movie, wanted, base));
    if (!candidate) { later(id, `No eligible ${wanted.name} audio donor is available yet.`); return; }
    const hash = await transmission.addAudioDonor(await getMovieAudioTorrentSource(candidate, signal), downloadDir, label);
    if (rejected.has(`hash:${hash.toLowerCase()}`)) {
      rejected.add(audioReleaseKey(candidate));
      updateMovieAudioJob(id, { rejectedDonors: JSON.stringify([...rejected]) });
      later(id, 'Searching for another audio release.', 'pending', 30_000);
      return;
    }
    const added = (await transmission.getAudioDonors()).find((torrent) => torrent.hashString === hash);
    if (added?.downloadDir !== downloadDir || added.labels?.length !== 1 || added.labels[0] !== label) {
      throw new AudioReviewError('Transmission did not retain the isolated donor folder and label. The torrent was left paused.');
    }
    // Persist before starting, so a restart can recover this exact owned torrent.
    updateMovieAudioJob(id, { donorHash: hash, donorLanguageId: wanted.id, donorMetadata: donorMetadata(candidate), donorIndexer: candidate.indexer || `Indexer ${candidate.indexerId}`, estimatedLanguages: JSON.stringify(candidate.languages ?? []), donorReleaseKey: audioReleaseKey(candidate), state: 'downloading', detail: `Downloading additional ${wanted.name} audio.`, nextAttemptAt: Date.now() + 30_000 });
    rememberDownloadTransfer('radarr', policy.radarrMovieId, hash);
    await transmission.resumeTorrent(hash);
    return;
  }
  updateMovieAudioJob(id, { donorHash: donor.hashString, donorLanguageId: wanted.id });
  rememberDownloadTransfer('radarr', policy.radarrMovieId, donor.hashString);
  if (donor.percentDone < 1) {
    await transmission.resumeTorrent(donor.hashString);
    later(id, `Downloading additional ${wanted.name} audio.`, 'downloading', 30_000);
    return;
  }
  const files = donor.files.filter((file) => /\.(mkv|mp4|m4v|avi|ts|m2ts|mpg|mpeg)$/i.test(file.name) &&
    !/(^|[\/._ -])(sample|trailer)([\/._ -]|$)/i.test(file.name));
  if (files.length !== 1 || files[0].length <= 0 || files[0].bytesCompleted !== files[0].length) {
    throw new AudioReviewError('The donor must contain exactly one complete movie file. Review this download.');
  }
  if (!movie.movieFile?.path) throw new AudioReviewError('Radarr did not return the current movie file path.');
  const source = await confinedFile(paths.library, movie.movieFile.path);
  const donorFile = await confinedFile(downloadDir, join(downloadDir, files[0].name));
  updateMovieAudioJob(id, { state: 'validating', detail: 'Checking the complete video timeline and audio tracks.', nextAttemptAt: Date.now() + 60_000 });
  const requiredAfterMerge = policy.requiredLanguages.filter((language) =>
    language.id === wanted.id || getAvailableAudio(movie).some((item) => item.id === language.id));
  // Recover safe quality metadata for donors downloaded before this field existed.
  let metadata = job.donorMetadata;
  if (!metadata && job.donorReleaseKey) {
    const prior = (await client.getReleases(policy.radarrMovieId)).find((release) => audioReleaseKey(release) === job.donorReleaseKey);
    if (prior) { metadata = donorMetadata(prior); updateMovieAudioJob(id, { donorMetadata: metadata }); }
  }
  const replaceWholeMovie = canReplaceFromDonor(metadata, movie, base) &&
    await containsAudioLanguages(donorFile, policy.requiredLanguages, signal);
  const prepared = replaceWholeMovie
    ? await prepareMovieReplacement(source, donorFile, policy.requiredLanguages, paths.backups, signal)
    : await prepareAudioMerge(source, donorFile, wanted, requiredAfterMerge, paths.backups, signal);
  const original = movie;
  let published = false;
  try {
    await noImport(client, policy.radarrMovieId);
    const current = await client.getMovie(policy.radarrMovieId);
    if (current.movieFile?.id !== original.movieFile?.id || current.movieFile?.path !== original.movieFile?.path) {
      throw new AudioReviewError('Radarr replaced the movie while the audio was being validated.');
    }
    updateMovieAudioJob(id, { restoreMonitored: current.monitored ?? true, state: replaceWholeMovie ? 'replacing' : 'merging',
      ...(replaceWholeMovie ? { donorMetadata: JSON.stringify({ ...JSON.parse(metadata!), publishedReplacement: true }) } : {}),
      detail: replaceWholeMovie ? 'Replacing the movie with a complete multilingual release.' : 'Publishing the verified movie with additional audio.' });
    await client.updateMovie({ ...current, monitored: false });
    await prepared.publish(async () => {
      await noImport(client, policy.radarrMovieId);
      const latest = await client.getMovie(policy.radarrMovieId);
      if (latest.movieFile?.id !== original.movieFile?.id || latest.movieFile?.path !== original.movieFile?.path) {
        throw new AudioReviewError('Radarr changed the movie before publication.');
      }
      updateMovieAudioJob(id, { outputPath: prepared.outputPath });
    });
    published = true;
    // Keep donor tracking until rescan verifies its audio. Retain the torrent and backup.
    updateMovieAudioJob(id, { state: 'verifying', detail: 'Merged audio saved. Waiting for Radarr to rescan.', nextAttemptAt: Date.now() + 60_000 });
    await client.rescanMovie(policy.radarrMovieId);
  } catch (error) {
    if (!published && !(error instanceof AudioReviewError)) {
      throw new AudioReviewError('Movie publication could not finish. Review the library and backup files before retrying.');
    }
    throw error;
  } finally {
    await prepared.dispose();
    const saved = getMovieAudioJobs().find((item) => item.tmdbId === id);
    if (saved?.restoreMonitored !== null && saved?.restoreMonitored !== undefined) await restoreMonitoring(client, policy, saved.restoreMonitored);
  }
}

// Older versions paused configuration failures permanently under needs_review.
// Recheck only these known setup failures; never reopen uncertain file publication.
const LEGACY_AUDIO_CONFIGURATION_ERRORS = new Set([
  'Transmission must be configured to download additional audio.',
  'Audio donors require Transmission 4+ and a nonempty Radarr Transmission category separate from queuearr-audio labels, with no directory override.',
]);
function isLegacyConfigurationFailure(job: MovieAudioJob): boolean {
  return job.state === 'needs_review' && job.restoreMonitored === null && !job.outputPath &&
    LEGACY_AUDIO_CONFIGURATION_ERRORS.has(job.detail);
}
function shouldProcessJob(job: MovieAudioJob): boolean {
  return job.restoreMonitored !== null || isLegacyConfigurationFailure(job) ||
    (job.nextAttemptAt <= Date.now() && !['available', 'needs_review', 'cancelled', 'cancelling'].includes(job.state));
}

export async function runMovieAudioJobs(): Promise<void> {
  const client = createRadarrClient();
  if (!client) return;
  const workerLock = acquireMovieAudioLock(0);
  if (!workerLock) return;
  const abort = new AbortController();
  let movieLock: string | null = null;
  const heartbeat = setInterval(() => {
    try {
      if (!renewMovieAudioLock(workerLock) || (movieLock && !renewMovieAudioLock(movieLock))) abort.abort();
    } catch { abort.abort(); }
  }, 30_000);
  try {
    for (const job of getMovieAudioJobs()) {
      if (abort.signal.aborted) break;
      if (!shouldProcessJob(job)) continue;
      movieLock = acquireMovieAudioLock(job.tmdbId + 2);
      if (!movieLock) continue;
      try {
        // Re-read under the movie lock: a request may have changed while another movie was processing.
        const current = getMovieAudioJobs().find((item) => item.tmdbId === job.tmdbId);
        const policy = getMovieAudioPolicies().get(job.tmdbId);
        if (!current || !policy) continue;
        if (!shouldProcessJob(current)) continue;
        if (isLegacyConfigurationFailure(current)) {
          console.info(`[audio] movie ${job.tmdbId}: rechecking a previous configuration failure`);
          current.state = 'waiting_for_configuration';
          current.detail = 'Error';
          updateMovieAudioJob(job.tmdbId, { state: current.state, detail: current.detail, nextAttemptAt: 0 });
        }
        await processJob(client, policy, current, abort.signal);
      }
      catch (error) {
        // Do not serialize HTTP errors: they can contain API keys and download URLs.
        if (error instanceof AudioConfigurationError) later(job.tmdbId, 'Error', 'waiting_for_configuration');
        else if (error instanceof AudioReviewError || error instanceof AudioProfileError) later(job.tmdbId, error.message, 'needs_review');
        else later(job.tmdbId, 'A service or shared folder is unavailable. Queuearr will retry in 15 minutes.');
        logMovieAudioError(`movie ${job.tmdbId}`, error,
          error instanceof AudioConfigurationError || error instanceof AudioReviewError || error instanceof AudioProfileError ? error.message : undefined);
      } finally { releaseMovieAudioLock(movieLock); movieLock = null; }
    }
  } finally { clearInterval(heartbeat); releaseMovieAudioLock(workerLock); }
}

const workerState = globalThis as typeof globalThis & { queuearrAudioTimer?: ReturnType<typeof setInterval> };
export function startMovieAudioWorker(): void {
  if (workerState.queuearrAudioTimer || process.env.NEXT_PHASE === 'phase-production-build') return;
  const tick = (): void => { void runMovieAudioJobs().catch(() => console.warn('[audio] Worker could not check requests.')); };
  workerState.queuearrAudioTimer = setInterval(tick, 30_000);
  workerState.queuearrAudioTimer.unref();
  tick();
}
