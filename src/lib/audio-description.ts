export interface AudioStreamMetadata {
  codec_type?: string;
  tags?: { language?: string; title?: string };
  disposition?: { comment?: number; visual_impaired?: number; descriptions?: number; default?: number };
}

/** Standalone AD is ambiguous in release names. Require an explicit description label. */
export function hasAudioDescriptionLabel(value: string): boolean {
  return /\b(?:audio[ ._-]*descriptions?|audio[ ._-]*described|descriptive[ ._-]*audio|audiodescription|described[ ._-]*video)\b/i.test(value);
}

export function releaseHasAudioDescription(release: { title: string; customFormats?: { name: string }[] }): boolean {
  return hasAudioDescriptionLabel([release.title, ...(release.customFormats ?? []).map((format) => format.name)].join(' '));
}

export function isDescriptiveAudioStream(stream: AudioStreamMetadata): boolean {
  return stream.disposition?.visual_impaired === 1 || stream.disposition?.descriptions === 1 ||
    /description|descriptive/i.test(stream.tags?.title ?? '') || /\b(?:AD|DVS)\b/.test(stream.tags?.title ?? '') ||
    /^(?:ad|dvs)$/i.test(stream.tags?.title?.trim() ?? '');
}

export function isMainAudioStream(stream: AudioStreamMetadata): boolean {
  return !stream.disposition?.comment && !/commentary|commentaire/i.test(stream.tags?.title ?? '') && !isDescriptiveAudioStream(stream);
}
