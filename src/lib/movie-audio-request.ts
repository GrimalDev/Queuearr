import type { RadarrClient } from '@/lib/api/radarr';
import { acquireMovieAudioLock, getMovieAudioPolicies, releaseMovieAudioLock, saveMovieAudioPolicy, getMovieAudioJobs, renewMovieAudioLock, updateMovieAudioJob, saveTrackedMovieAudioRequest } from '@/lib/db/movie-audio';
import { getAvailableAudio, hasRequiredAudio, mergeAudioLanguages, normalizeMovieAudioPolicy, resolveAudioLanguage } from '@/lib/movie-audio-policy';
import { AUDIO_PROFILE_PREFIX, AudioProfileError, ensureAudioProfile } from '@/lib/radarr-audio-profile';
import { isMovieRegrab } from '@/lib/movie-audio-releases';
import { startDownloadRetryCooldown } from '@/lib/download-retry';
import type { MovieAudioLanguage, RadarrLanguage } from '@/types';

export class MovieAudioRequestError extends Error {
  constructor(message: string, public status: number = 409) {
    super(message);
    this.name = 'MovieAudioRequestError';
  }
}

export interface MovieAudioRequestResult {
  movieId: number;
  state: string;
  detail: string;
  requiredLanguages: RadarrLanguage[];
  availableLanguages: RadarrLanguage[];
  searchStarted: boolean;
  hasFile: boolean;
}

export async function requestMovieAudio(
  client: RadarrClient, tmdbId: number, choice: MovieAudioLanguage, userId: string, forceDownload = false,
): Promise<MovieAudioRequestResult> {
  const movieLock = acquireMovieAudioLock(tmdbId + 2);
  if (!movieLock) throw new MovieAudioRequestError('This movie’s audio is being processed. Please try again shortly.');
  const lock = acquireMovieAudioLock();
  if (!lock) {
    releaseMovieAudioLock(movieLock);
    throw new MovieAudioRequestError('Another audio request is being saved. Please try again in a moment.');
  }
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try { leaseLost = !renewMovieAudioLock(movieLock) || !renewMovieAudioLock(lock); }
    catch { leaseLost = true; }
  }, 30_000);
  try {
    const previousJob = getMovieAudioJobs().find((job) => job.tmdbId === tmdbId);
    if (previousJob?.restoreMonitored !== null && previousJob?.restoreMonitored !== undefined) {
      throw new MovieAudioRequestError('An interrupted merge needs recovery. Please wait for the audio worker.');
    }
    if (previousJob?.state === 'cancelling') throw new MovieAudioRequestError('Finish cancelling this download before requesting audio.');
    if (previousJob?.state === 'needs_review') throw new MovieAudioRequestError(previousJob.detail);
    if (previousJob?.state === 'grab_pending') throw new MovieAudioRequestError('A release has already been sent to Radarr. Wait for its download client before submitting another request.');
    const [movies, profiles] = await Promise.all([client.getMovies(), client.getQualityProfiles()]);
    let movie = movies.find((item) => item.tmdbId === tmdbId);
    if (movie?.id) movie = await client.getMovie(movie.id);
    else movie = await client.searchByTmdbId(tmdbId);
    if (!movie) throw new MovieAudioRequestError('Movie not found in Radarr lookup.', 404);
    const requested = resolveAudioLanguage(choice, movie);
    if (!requested) throw new MovieAudioRequestError('Radarr does not know this movie’s original language yet. Choose English or French, or correct its metadata.');
    const available = getAvailableAudio(movie);
    if (movie.hasFile && (!available.length || movie.movieFile?.languages?.some((language) => language.id <= 0))) {
      throw new MovieAudioRequestError('Radarr has not identified all audio languages in the existing file. Analyze it in Radarr before requesting a replacement.');
    }
    const saved = getMovieAudioPolicies().get(tmdbId);
    const policy = saved ? normalizeMovieAudioPolicy(saved, movie) : undefined;
    const baseProfileId = policy?.baseProfileId ?? (movie.id ? movie.qualityProfileId : undefined) ??
      (process.env.RADARR_QUALITY_PROFILE_ID ? Number(process.env.RADARR_QUALITY_PROFILE_ID) :
        profiles.find((profile) => !profile.name.startsWith(AUDIO_PROFILE_PREFIX))?.id);
    const base = profiles.find((profile) => profile.id === baseProfileId);
    if (!base || base.name.startsWith(AUDIO_PROFILE_PREFIX)) {
      throw new MovieAudioRequestError('Configure a base quality profile in Radarr before requesting audio.', 503);
    }
    const required = mergeAudioLanguages(policy?.requiredLanguages ?? [], [requested]);
    let rootFolderPath: string | undefined;
    if (!movie.id) {
      const folders = await client.getRootFolders();
      rootFolderPath = process.env.RADARR_ROOT_FOLDER_PATH || folders.find((folder) => folder.accessible !== false)?.path;
      if (!rootFolderPath || !folders.some((folder) => folder.path === rootFolderPath && folder.accessible !== false)) {
        throw new MovieAudioRequestError('Configure an accessible Radarr root folder before requesting audio.', 503);
      }
    }
    const profile = await ensureAudioProfile(client, base, movie.hasFile ? required : [required[0]]);
    if (leaseLost) throw new MovieAudioRequestError('The request lock expired. Please retry.');
    if (!movie.id) {
      movie = await client.addMovie({
        title: movie.title, tmdbId, year: movie.year, qualityProfileId: profile.id,
        rootFolderPath: rootFolderPath!, searchForMovie: false,
      });
    }
    if (!movie.id) throw new Error('Radarr returned a movie without an ID');
    const savedPolicy = { tmdbId, radarrMovieId: movie.id, baseProfileId: base.id, requiredLanguages: required,
      explicitLanguageRequests: policy?.explicitLanguageRequests ?? true };
    const continuing = !!previousJob?.donorHash || !!previousJob?.outputPath || previousJob?.regrabFileId != null;
    const searchReplacement = !!movie.hasFile && !!previousJob?.donorHash && !previousJob.outputPath &&
      previousJob.regrabFileId == null && !previousJob.replaceDonor &&
      required.some((language) => !policy?.requiredLanguages.some((saved) => saved.id === language.id));
    const pendingJob = { state: searchReplacement ? 'pending' : continuing ? previousJob!.state : hasRequiredAudio(movie, required) && !forceDownload ? 'available' : 'pending',
      detail: searchReplacement ? 'Searching for a complete movie with all requested audio.' : continuing ? previousJob!.detail : 'Applying the requested audio profile.', nextAttemptAt: 0,
      ...(!continuing ? { estimatedLanguages: '[]' } : {}) };
    if (forceDownload || !hasRequiredAudio(movie, required)) {
      saveTrackedMovieAudioRequest(savedPolicy, pendingJob, movie.title, userId);
    } else {
      saveMovieAudioPolicy(savedPolicy);
      updateMovieAudioJob(tmdbId, pendingJob);
    }
    movie = await client.updateMovie({ ...movie, qualityProfileId: profile.id, monitored: true });
    if (!movie.id) throw new Error('Radarr returned a movie without an ID');
    const movieId = movie.id;
    const satisfied = hasRequiredAudio(movie, required);
    const regrabbing = previousJob?.regrabFileId !== null && previousJob?.regrabFileId !== undefined;
    const processingAudio = !!previousJob?.donorHash || !!previousJob?.outputPath;
    let detail = searchReplacement ? 'Searching for a complete movie with all requested audio.' : regrabbing || processingAudio ? previousJob!.detail :
      satisfied ? 'All requested audio languages are available.' : 'Searching for a release with the requested audio.';
    let state = searchReplacement ? 'pending' : regrabbing || processingAudio ? previousJob!.state : satisfied ? 'available' : 'pending';
    updateMovieAudioJob(tmdbId, { state, detail, nextAttemptAt: 0 });
    let searchStarted = false;
    if (forceDownload && satisfied && !regrabbing && !processingAudio) {
      const queue = await client.getQueue(false);
      if (queue.records.some((item) => item.movieId === movie.id)) {
        throw new MovieAudioRequestError('Radarr already has a download or import in progress for this movie.');
      }
      if (!movie.movieFile?.id) throw new MovieAudioRequestError('Radarr has not identified the existing movie file yet.');
      const releases = await client.getReleases(movieId);
      const candidate = releases.find((release) => isMovieRegrab(release, movie, required, profile));
      if (!candidate) {
        throw new MovieAudioRequestError('No release can be regrabbed with all requested languages at the current quality or better. The existing movie is still available.');
      }
      if (leaseLost) throw new MovieAudioRequestError('The request lock expired. Please retry.');
      startDownloadRetryCooldown('radarr', movieId);
      state = 'regrabbing';
      detail = 'Sending a fresh download to Radarr. The existing movie stays available until import.';
      // Persist before submitting: a lost response must not cause duplicate grabs or early completion.
      updateMovieAudioJob(tmdbId, { state, detail, regrabFileId: movie.movieFile.id,
        donorIndexer: candidate.indexer || `Indexer ${candidate.indexerId}`, estimatedLanguages: JSON.stringify(candidate.languages ?? []),
        regrabRequestedAt: Date.now(), nextAttemptAt: Date.now() + 30_000 });
      try {
        await client.grabRelease(candidate.guid, candidate.indexerId);
        searchStarted = true;
      } catch {
        detail = 'Radarr has not confirmed the regrab yet. Checking its download queue.';
        updateMovieAudioJob(tmdbId, { detail });
      }
    } else if (!satisfied || regrabbing) {
      if (!processingAudio && !regrabbing) startDownloadRetryCooldown('radarr', movieId);
      // The durable worker searches for a full replacement before considering donors.
      // A separate Radarr search here could race that selection and its fallback.
    }
    return {
      movieId: movie.id!, state, detail,
      requiredLanguages: required, availableLanguages: getAvailableAudio(movie), searchStarted, hasFile: !!movie.hasFile,
    };
  } catch (error) {
    if (error instanceof AudioProfileError) throw new MovieAudioRequestError(error.message);
    throw error;
  } finally {
    clearInterval(heartbeat);
    releaseMovieAudioLock(lock);
    releaseMovieAudioLock(movieLock);
  }
}
