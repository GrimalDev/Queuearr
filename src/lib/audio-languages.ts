import type { RadarrLanguage } from '@/types';

const LANGUAGE_CODES: Record<string, string> = {
  english: 'EN', french: 'FR', german: 'DE', spanish: 'ES', italian: 'IT', portuguese: 'PT',
  japanese: 'JA', korean: 'KO', chinese: 'ZH', mandarin: 'ZH', cantonese: 'YUE', dutch: 'NL',
  danish: 'DA', swedish: 'SV', norwegian: 'NO', finnish: 'FI', icelandic: 'IS', polish: 'PL',
  russian: 'RU', ukrainian: 'UK', czech: 'CS', slovak: 'SK', hungarian: 'HU', romanian: 'RO',
  bulgarian: 'BG', greek: 'EL', turkish: 'TR', arabic: 'AR', hebrew: 'HE', hindi: 'HI',
  bengali: 'BN', tamil: 'TA', telugu: 'TE', punjabi: 'PA', urdu: 'UR', persian: 'FA',
  thai: 'TH', vietnamese: 'VI', indonesian: 'ID', malay: 'MS', tagalog: 'TL', filipino: 'FIL',
  croatian: 'HR', serbian: 'SR', slovenian: 'SL', bosnian: 'BS', albanian: 'SQ',
  estonian: 'ET', latvian: 'LV', lithuanian: 'LT', catalan: 'CA', basque: 'EU',
  galician: 'GL', welsh: 'CY', irish: 'GA', afrikaans: 'AF', swahili: 'SW',
};

export function audioLanguageMarker(language: RadarrLanguage): string {
  return LANGUAGE_CODES[language.name.trim().toLowerCase()] ?? language.name;
}

export function normalizeAudioLanguages(value: unknown): RadarrLanguage[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, RadarrLanguage>();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || !('id' in item) || !('name' in item) || typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== 'string') continue;
    const name = item.name.trim();
    if (!name || /^(unknown|any|original|multi|multiple)$/i.test(name)) continue;
    result.set(name.toLowerCase(), { id: item.id, name });
  }
  return [...result.values()];
}

export function readAudioLanguages(value?: string | null): RadarrLanguage[] {
  try { return value ? normalizeAudioLanguages(JSON.parse(value)) : []; }
  catch { return []; }
}
