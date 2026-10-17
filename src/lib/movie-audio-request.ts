import type { RadarrClient } from '@/lib/api/radarr';
import { acquireMovieAudioLock, getMovieAudioPolicies, releaseMovieAudioLock, saveMovieAudioPolicy, getMovieAudioJobs, renewMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { addUserToDownload, reopenMonitoredDownload } from '@/lib/db/monitored-downloads';
import { getAvailableAudio, hasRequiredAudio, mergeAudioLanguages, resolveAudioLanguage } from '@/lib/movie-audio-policy';
import { AUDIO_PROFILE_PREFIX, AudioProfileError, ensureAudioProfile } from '@/lib/radarr-audio-profile';
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
}

export async function requestMovieAudio(
  client: RadarrClient, tmdbId: number, choice: MovieAudioLanguage, userId: string,
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
    if (previousJob?.state === 'needs_review') throw new MovieAudioRequestError(previousJob.detail);
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
    const policy = getMovieAudioPolicies().get(tmdbId);
    const baseProfileId = policy?.baseProfileId ?? (movie.id ? movie.qualityProfileId : undefined) ??
      (process.env.RADARR_QUALITY_PROFILE_ID ? Number(process.env.RADARR_QUALITY_PROFILE_ID) :
        profiles.find((profile) => !profile.name.startsWith(AUDIO_PROFILE_PREFIX))?.id);
    const base = profiles.find((profile) => profile.id === baseProfileId);
    if (!base || base.name.startsWith(AUDIO_PROFILE_PREFIX)) {
      throw new MovieAudioRequestError('Configure a base quality profile in Radarr before requesting audio.', 503);
    }
    const required = mergeAudioLanguages(policy?.requiredLanguages ?? [], available, [requested]);
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
    saveMovieAudioPolicy({ tmdbId, radarrMovieId: movie.id, baseProfileId: base.id, requiredLanguages: required });
    updateMovieAudioJob(tmdbId, { state: previousJob?.state ?? 'pending', detail: previousJob?.detail ?? 'Applying the requested audio profile.', nextAttemptAt: 0 });
    movie = await client.updateMovie({ ...movie, qualityProfileId: profile.id, monitored: true });
    const satisfied = hasRequiredAudio(movie, required);
    const detail = satisfied ? 'All requested audio languages are available.' :
      previousJob?.donorHash || previousJob?.outputPath ? previousJob.detail : 'Searching for a release with the requested audio.';
    const state = satisfied ? 'available' : previousJob?.donorHash || previousJob?.outputPath ? previousJob.state : 'pending';
    updateMovieAudioJob(tmdbId, { state, detail, nextAttemptAt: 0 });
    let searchStarted = false;
    if (!satisfied) {
      const monitored = await reopenMonitoredDownload('radarr', movie.id!, movie.title);
      await addUserToDownload(monitored.id, userId);
      try {
        // Radarr manages the initial video; the worker handles additional audio.
        if (!previousJob?.donorHash && !previousJob?.outputPath &&
            !(await client.getQueue(false)).records.some((item) => item.movieId === movie.id)) {
          await client.triggerSearch([movie.id!]);
          searchStarted = true;
        }
      } catch {
        // Keep the request/profile so a retry or Radarr RSS can satisfy it later.
        console.warn('[audio] Request saved but Radarr could not start the movie search');
      }
    }
    return {
      movieId: movie.id!, state, detail,
      requiredLanguages: required, availableLanguages: getAvailableAudio(movie), searchStarted,
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
