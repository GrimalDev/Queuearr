import type { MediaQuality, QualityProfileItem, RadarrLanguage, RadarrMovie, RadarrQualityProfile, Release } from '@/types';

function allowedQuality(items: QualityProfileItem[], id: number): boolean {
  return items.some((item) => item.items?.length
    ? item.allowed !== false && allowedQuality(item.items, id)
    : item.quality?.id === id && item.allowed === true);
}

/** Only bypass rejections about replacing the existing file or missing other audio. */
export function isAudioDonor(
  release: Release, movie: RadarrMovie, language: RadarrLanguage, base: RadarrQualityProfile,
): boolean {
  if (release.protocol !== 'torrent' || !release.languages?.some((item) => item.id === language.id)) return false;
  if (!movie.id || release.mappedMovieId !== movie.id || (release.tmdbId && release.tmdbId !== movie.tmdbId)) return false;
  if (!release.magnetUrl && !release.downloadUrl) return false;
  if (!release.seeders || release.seeders < 1) return false;
  const quality = release.quality?.quality;
  if (!quality || !allowedQuality(base.items ?? [], quality.id)) return false;
  if (/cam|telesync|telecine|workprint/i.test(quality.source) || /\b(CAM|CAMRIP|TELESYNC|TELECINE|WORKPRINT|TS)\b/i.test(release.title)) return false;
  if ((release.edition ?? '').toLowerCase() !== (movie.movieFile?.edition ?? '').toLowerCase()) return false;
  const score = (release.customFormats ?? []).reduce((total, format) =>
    total + (base.formatItems?.find((item) => item.format === format.id)?.score ?? 0), 0);
  if (score < (base.minFormatScore ?? 0)) return false;
  const allowedRejection = /^(Custom Formats .+ have score -?\d+ below Movie's profile minimum -?\d+|Existing file meets cutoff: .+|Existing file on disk (is of equal or higher (preference|revision): .+|meets (quality|Custom Format) cutoff: .+|has a equal or higher Custom Format score: .+|has Custom Format score within Custom Format score increment: .+))$/;
  if (release.rejections?.some((reason) => !allowedRejection.test(reason))) return false;
  return release.downloadAllowed !== false || !!release.rejections?.length;
}

function qualityRank(items: QualityProfileItem[], id: number): number {
  return items.findIndex((item) => item.items?.length
    ? item.allowed !== false && allowedQuality(item.items, id)
    : item.allowed === true && item.quality?.id === id);
}

export function donorMetadata(release: Release): string {
  return JSON.stringify({ quality: release.quality, edition: release.edition ?? '' });
}

export function canReplaceFromDonor(metadata: string | null | undefined, movie: RadarrMovie, profile: RadarrQualityProfile): boolean {
  try {
    if (!metadata) return false;
    const saved = JSON.parse(metadata) as { quality?: MediaQuality; edition?: string };
    const quality = saved.quality;
    const current = movie.movieFile?.quality;
    if (!quality?.quality || !current?.quality || !quality.revision || !current.revision ||
        !Number.isSafeInteger(quality.quality.id) || !Number.isSafeInteger(quality.revision.version) || !Number.isSafeInteger(quality.revision.real) ||
        typeof saved.edition !== 'string' || saved.edition.toLowerCase() !== (movie.movieFile?.edition ?? '').toLowerCase() ||
        /cam|telesync|telecine|workprint/i.test(quality.quality.source)) return false;
    const rank = qualityRank(profile.items ?? [], quality.quality.id);
    const currentRank = qualityRank(profile.items ?? [], current.quality.id);
    return rank >= 0 && currentRank >= 0 && (rank > currentRank || rank === currentRank &&
      quality.revision.version >= current.revision.version && quality.revision.real >= current.revision.real);
  } catch { return false; }
}

export function publishedDonorQuality(metadata?: string | null): MediaQuality | undefined {
  try {
    const saved = JSON.parse(metadata ?? '{}') as { publishedReplacement?: boolean; quality?: MediaQuality };
    return saved.publishedReplacement === true && saved.quality?.quality && saved.quality.revision ? saved.quality : undefined;
  } catch { return undefined; }
}

/** A manual regrab may override existing-file cutoffs, never language or quality rules. */
export function isMovieRegrab(
  release: Release, movie: RadarrMovie, required: RadarrLanguage[], profile: RadarrQualityProfile,
): boolean {
  if (!movie.id || release.mappedMovieId !== movie.id || (release.tmdbId && release.tmdbId !== movie.tmdbId)) return false;
  if (!required.every((language) => release.languages?.some((item) => item.id === language.id))) return false;
  const quality = release.quality?.quality;
  const currentQuality = movie.movieFile?.quality?.quality;
  if (!quality || !currentQuality) return false;
  const rank = qualityRank(profile.items ?? [], quality.id);
  const currentRank = qualityRank(profile.items ?? [], currentQuality.id);
  if (rank < 0 || currentRank < 0 || rank < currentRank) return false;
  if (rank === currentRank && release.quality && movie.movieFile?.quality &&
      (release.quality.revision.version < movie.movieFile.quality.revision.version ||
       release.quality.revision.real < movie.movieFile.quality.revision.real)) return false;
  if (/cam|telesync|telecine|workprint/i.test(quality.source) || /\b(CAM|CAMRIP|TELESYNC|TELECINE|WORKPRINT|TS)\b/i.test(release.title)) return false;
  if ((release.edition ?? '').toLowerCase() !== (movie.movieFile?.edition ?? '').toLowerCase()) return false;
  const score = (release.customFormats ?? []).reduce((total, format) =>
    total + (profile.formatItems?.find((item) => item.format === format.id)?.score ?? 0), 0);
  if (score < (profile.minFormatScore ?? 0)) return false;
  const existingFileRejection = /^(Existing file meets cutoff: .+|Existing file on disk (is of equal or higher (preference|revision): .+|meets (quality|Custom Format) cutoff: .+|has a equal or higher Custom Format score: .+|has Custom Format score within Custom Format score increment: .+))$/;
  if (release.rejections?.some((reason) => !existingFileRejection.test(reason))) return false;
  return release.downloadAllowed !== false || !!release.rejections?.length;
}
