import type { RadarrMovie } from '@/types';

export const IN_CINEMAS_SEARCH_MESSAGE = 'Still in cinemas. No suitable release is available yet.';

/** Classify a successful search with no eligible release, never a service failure. */
export function isMovieInCinemas(movie: RadarrMovie, now = Date.now()): boolean {
  if (movie.hasFile) return false;
  const homeReleases = [movie.digitalRelease, movie.physicalRelease]
    .map((date) => date ? Date.parse(date) : NaN).filter(Number.isFinite);
  if (homeReleases.some((date) => date <= now)) return false;
  const cinemaDate = movie.inCinemas ? Date.parse(movie.inCinemas) : NaN;
  if (cinemaDate > now) return false;
  if (movie.status) return movie.status === 'inCinemas';
  return cinemaDate <= now && homeReleases.some((date) => date > now);
}
