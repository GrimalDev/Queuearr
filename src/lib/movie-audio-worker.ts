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
import { getAvailableAudio, hasRequiredAudio, mergeAudioLanguages } from '@/lib/movie-audio-policy';
import { AudioReviewError, confinedFile, isInside, languageCodes, prepareAudioMerge, verifyAudio } from '@/lib/movie-audio-media';
import { isAudioDonor } from '@/lib/movie-audio-releases';
import { getMovieAudioTorrentSource } from '@/lib/movie-audio-download';
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
  let movie = await client.getMovie(policy.radarrMovieId);
  if (movie.tmdbId !== id) throw new AudioReviewError('The Radarr movie no longer matches this request.');
  if (job.regrabFileId !== null) {
    const downloading = (await client.getQueue(false)).records.some((item) => item.movieId === movie.id);
    if (downloading) {
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
  const union = mergeAudioLanguages(policy.requiredLanguages, getAvailableAudio(movie));
  if (union.length !== policy.requiredLanguages.length) {
    policy = { ...policy, requiredLanguages: union };
    saveMovieAudioPolicy(policy);
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
    }
    updateMovieAudioJob(id, { state: 'available', detail: 'All requested audio languages are available.', outputPath: null, donorHash: null, donorLanguageId: null });
    return;
  }
  if (job.outputPath) {
    const mergedLanguage = policy.requiredLanguages.find((language) => language.id === job.donorLanguageId);
    if (movie.movieFile?.path === job.outputPath && mergedLanguage && hasRequiredAudio(movie, [mergedLanguage])) {
      const paths = await audioPaths();
      await verifyAudio(await confinedFile(paths.library, job.outputPath), getAvailableAudio(movie), signal);
      updateMovieAudioJob(id, { outputPath: null, donorHash: null, donorLanguageId: null, state: 'pending', nextAttemptAt: 0 });
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
    await client.triggerSearch([policy.radarrMovieId]);
    later(id, 'Searching for the initial movie release. Additional audio is processed after import.');
    return;
  }
  const missing = policy.requiredLanguages.filter((language) => !getAvailableAudio(movie).some((item) => item.id === language.id));
  const wanted = job.donorLanguageId ? missing.find((language) => language.id === job.donorLanguageId) : missing[0];
  if (!wanted) {
    updateMovieAudioJob(id, { donorHash: null, donorLanguageId: null, nextAttemptAt: 0 });
    return;
  }
  let releases: Release[] = [];
  if (!job.donorHash) {
    releases = await client.getReleases(policy.radarrMovieId);
    // Radarr returns decisions in its quality/profile preference order.
    const complete = releases.find((release) => release.downloadAllowed !== false && !release.rejections?.length &&
      policy.requiredLanguages.every((language) => release.languages?.some((item) => item.id === language.id)));
    if (complete) {
      await client.grabRelease(complete.guid, complete.indexerId);
      later(id, 'Downloading a release containing all requested languages.', 'downloading');
      return;
    }
  }
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
  const donor = torrents.find((torrent) => torrent.labels?.length === 1 && torrent.labels[0] === label && torrent.downloadDir === downloadDir &&
    (!job.donorHash || torrent.hashString.toLowerCase() === job.donorHash.toLowerCase()));
  if (!donor) {
    if (job.donorHash) throw new AudioReviewError('The tracked audio torrent is missing or its folder/label changed.');
    const candidate = releases.find((release) => isAudioDonor(release, movie, wanted, base));
    if (!candidate) { later(id, `No eligible ${wanted.name} audio donor is available yet.`); return; }
    const hash = await transmission.addAudioDonor(await getMovieAudioTorrentSource(candidate, signal), downloadDir, label);
    const added = (await transmission.getAudioDonors()).find((torrent) => torrent.hashString === hash);
    if (added?.downloadDir !== downloadDir || added.labels?.length !== 1 || added.labels[0] !== label) {
      throw new AudioReviewError('Transmission did not retain the isolated donor folder and label. The torrent was left paused.');
    }
    // Persist before starting, so a restart can recover this exact owned torrent.
    updateMovieAudioJob(id, { donorHash: hash, donorLanguageId: wanted.id, state: 'downloading', detail: `Downloading additional ${wanted.name} audio.`, nextAttemptAt: Date.now() + 30_000 });
    await transmission.resumeTorrent(hash);
    return;
  }
  updateMovieAudioJob(id, { donorHash: donor.hashString, donorLanguageId: wanted.id });
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
  const prepared = await prepareAudioMerge(source, donorFile, wanted, requiredAfterMerge, paths.backups, signal);
  const original = movie;
  let published = false;
  try {
    await noImport(client, policy.radarrMovieId);
    const current = await client.getMovie(policy.radarrMovieId);
    if (current.movieFile?.id !== original.movieFile?.id || current.movieFile?.path !== original.movieFile?.path) {
      throw new AudioReviewError('Radarr replaced the movie while the audio was being validated.');
    }
    updateMovieAudioJob(id, { restoreMonitored: current.monitored ?? true, state: 'merging', detail: 'Publishing the verified movie with additional audio.' });
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
    (job.nextAttemptAt <= Date.now() && !['available', 'needs_review'].includes(job.state));
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
