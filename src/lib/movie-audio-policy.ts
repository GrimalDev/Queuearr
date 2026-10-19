import type { MovieAudioLanguage, RadarrLanguage, RadarrMovie } from '@/types';
import { IN_CINEMAS_SEARCH_MESSAGE } from '@/lib/movie-release-status';

export const MOVIE_AUDIO_OPTIONS: { value: MovieAudioLanguage; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'english', label: 'English' },
  { value: 'french', label: 'French' },
];

export function isMovieAudioLanguage(value: unknown): value is MovieAudioLanguage {
  return MOVIE_AUDIO_OPTIONS.some((option) => option.value === value);
}

export function mergeAudioLanguages(...lists: RadarrLanguage[][]): RadarrLanguage[] {
  const languages = new Map<number, RadarrLanguage>();
  for (const language of lists.flat()) {
    if (Number.isSafeInteger(language.id) && language.id > 0) languages.set(language.id, language);
  }
  return [...languages.values()].sort((a, b) => a.id - b.id);
}

export function getAvailableAudio(movie: RadarrMovie): RadarrLanguage[] {
  return movie.hasFile ? mergeAudioLanguages(movie.movieFile?.languages ?? []) : [];
}

export function hasRequiredAudio(movie: RadarrMovie, required: RadarrLanguage[]): boolean {
  const available = new Set(getAvailableAudio(movie).map((language) => language.id));
  return !!movie.hasFile && required.length > 0 && required.every((language) => available.has(language.id));
}

export function resolveAudioLanguage(choice: MovieAudioLanguage, movie: RadarrMovie): RadarrLanguage | null {
  if (choice === 'english') return { id: 1, name: 'English' };
  if (choice === 'french') return { id: 2, name: 'French' };
  return movie.originalLanguage && movie.originalLanguage.id > 0 ? movie.originalLanguage : null;
}

export function getPublicMovieAudioDetail(state?: string, detail?: string): string | undefined {
  if (state === 'in_cinemas') return IN_CINEMAS_SEARCH_MESSAGE;
  if (state === 'needs_review' || state === 'waiting_for_configuration' || state === 'error' || state === 'failed' || state === 'search_failed' || state === 'cancelling' ||
      detail === 'A service or shared folder is unavailable. Queuearr will retry in 15 minutes.') {
    return 'Error';
  }
  return detail;
}
