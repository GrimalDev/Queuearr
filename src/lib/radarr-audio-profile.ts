import { createHash } from 'node:crypto';
import type { RadarrClient } from '@/lib/api/radarr';
import type { RadarrCustomFormat, RadarrLanguage, RadarrQualityProfile } from '@/types';

export class AudioProfileError extends Error {}

export const AUDIO_PROFILE_PREFIX = 'Queuearr audio ';

function audioProfileName(baseId: number, profile: Omit<RadarrQualityProfile, 'id'>): string {
  const fingerprint = createHash('sha256').update(JSON.stringify({
    name: '',
    upgradeAllowed: profile.upgradeAllowed,
    cutoff: profile.cutoff,
    items: profile.items,
    language: profile.language,
    minFormatScore: profile.minFormatScore,
    cutoffFormatScore: profile.cutoffFormatScore,
    minUpgradeFormatScore: profile.minUpgradeFormatScore,
    formatItems: profile.formatItems?.filter((item) => item.score !== 0)
      .map(({ format, name, score }) => ({ format, name, score })).sort((a, b) => a.format - b.format),
  })).digest('hex').slice(0, 12);
  return `${AUDIO_PROFILE_PREFIX}${baseId} ${fingerprint}`;
}

/** A name prefix alone cannot prove that a profile is an unchanged generated copy. */
export function isUnmodifiedAudioProfile(profile: RadarrQualityProfile): boolean {
  const match = /^Queuearr audio ([1-9]\d*) [a-f0-9]{12}$/.exec(profile.name);
  return !!match && !!profile.items?.length && !!profile.formatItems?.some((item) => item.score < 0) &&
    profile.name === audioProfileName(Number(match[1]), profile);
}

export function missingAudioFormat(language: RadarrLanguage): Omit<RadarrCustomFormat, 'id'> {
  return {
    name: `Queuearr: Missing ${language.name} audio (${language.id})`,
    includeCustomFormatWhenRenaming: false,
    specifications: [{
      name: `Missing ${language.name}`,
      implementation: 'LanguageSpecification',
      negate: true,
      required: false,
      fields: [{ name: 'value', value: language.id }, { name: 'exceptLanguage', value: false }],
    }],
  };
}

function matchesMissingAudio(format: RadarrCustomFormat, language: RadarrLanguage): boolean {
  const [spec] = format.specifications;
  return format.specifications.length === 1 && spec.implementation === 'LanguageSpecification' &&
    spec.negate === true && spec.fields.some((field) => field.name === 'value' && field.value === language.id) &&
    !spec.fields.some((field) => field.name === 'exceptLanguage' && field.value === true);
}

export function buildAudioProfile(
  base: RadarrQualityProfile,
  formats: RadarrCustomFormat[],
  requiredFormats: RadarrCustomFormat[],
): Omit<RadarrQualityProfile, 'id'> {
  if (!base.items?.length || base.cutoff === undefined || requiredFormats.length === 0) {
    throw new AudioProfileError('The Radarr quality profile is incomplete. Configure its allowed qualities first.');
  }
  const scores = new Map(base.formatItems?.map((item) => [item.format, item.score]) ?? []);
  const requiredIds = new Set(requiredFormats.map((format) => format.id));
  const minFormatScore = base.minFormatScore ?? 0;
  // One missing language must fail the minimum even if every positive CF matches.
  const positiveTotal = [...scores.values()].reduce((sum, score) => sum + Math.max(0, score), 0);
  const penalty = positiveTotal + Math.abs(minFormatScore) + 10_000;
  if (!Number.isSafeInteger(penalty) || penalty * requiredFormats.length > 2_000_000_000) {
    throw new AudioProfileError('Radarr custom format scores are too large to enforce audio requirements safely.');
  }
  const profile = {
    name: '',
    upgradeAllowed: true,
    cutoff: base.cutoff,
    items: base.items,
    language: { id: -1, name: 'Any' },
    minFormatScore,
    cutoffFormatScore: Math.max(minFormatScore, base.cutoffFormatScore ?? 0),
    minUpgradeFormatScore: base.minUpgradeFormatScore ?? 1,
    formatItems: formats.map((format) => ({
      format: format.id,
      name: format.name,
      score: requiredIds.has(format.id) ? -penalty : (scores.get(format.id) ?? 0),
    })),
  };
  // New base-profile settings produce a new copy instead of changing other movies.
  profile.name = audioProfileName(base.id, profile);
  return profile;
}

export async function ensureAudioProfile(
  client: RadarrClient,
  base: RadarrQualityProfile,
  languages: RadarrLanguage[],
): Promise<RadarrQualityProfile> {
  let formats = await client.getCustomFormats();
  const requiredFormats: RadarrCustomFormat[] = [];
  for (const language of languages) {
    const desired = missingAudioFormat(language);
    let format = formats.find((item) => item.name === desired.name);
    if (!format) {
      try {
        format = await client.createCustomFormat(desired);
      } catch (error) {
        // Recover a successful creation whose HTTP response was lost.
        formats = await client.getCustomFormats();
        format = formats.find((item) => item.name === desired.name);
        if (!format) throw error;
      }
    }
    if (!matchesMissingAudio(format, language)) {
      throw new AudioProfileError(`The managed Radarr format "${desired.name}" was changed. Restore its missing-language condition before requesting audio.`);
    }
    requiredFormats.push(format);
  }
  // Radarr requires every custom format, including newly created ones, in a profile.
  formats = await client.getCustomFormats();
  if (requiredFormats.some((required) => !formats.some((format) => format.id === required.id))) {
    throw new AudioProfileError('A required audio custom format was removed. Please retry.');
  }
  const desired = buildAudioProfile(base, formats, requiredFormats);
  const profiles = await client.getQualityProfiles();
  const existing = profiles.find((profile) => profile.name === desired.name);
  if (existing) {
    const comparable = (profile: Omit<RadarrQualityProfile, 'id'>): string => JSON.stringify({
      upgradeAllowed: profile.upgradeAllowed,
      cutoff: profile.cutoff,
      items: profile.items,
      language: profile.language?.id,
      minFormatScore: profile.minFormatScore,
      cutoffFormatScore: profile.cutoffFormatScore,
      minUpgradeFormatScore: profile.minUpgradeFormatScore,
      scores: profile.formatItems?.filter((item) => item.score !== 0)
        .map((item) => [item.format, item.score]).sort((a, b) => a[0] - b[0]),
    });
    if (comparable(existing) !== comparable(desired)) {
      throw new AudioProfileError('The managed Radarr audio profile was edited. Restore it or choose another base quality profile.');
    }
    return existing;
  }
  return client.createQualityProfile(desired);
}
