import { createHash } from 'node:crypto';
import type { Release } from '@/types';

export function audioReleaseKey(release: Pick<Release, 'guid' | 'indexerId'>): string {
  // Release GUIDs may be signed URLs. Persist only a digest, never their credentials.
  return `release:${createHash('sha256').update(`${release.indexerId}:${release.guid}`).digest('hex')}`;
}

export function rejectedAudioDonors(value: string): Set<string> {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string' || !/^(hash|release):[a-f0-9]{40,64}$/.test(entry))) {
    throw new Error('Invalid audio retry history');
  }
  return new Set(parsed as string[]);
}

export function isRejectedAudioRelease(release: Release, rejected: Set<string>): boolean {
  if (rejected.has(audioReleaseKey(release))) return true;
  if (release.infoHash && rejected.has(`hash:${release.infoHash.toLowerCase()}`)) return true;
  if (release.magnetUrl) {
    try {
      const hashes = new URL(release.magnetUrl).searchParams.getAll('xt');
      return hashes.some((hash) => rejected.has(`hash:${hash.replace(/^urn:btih:/i, '').toLowerCase()}`));
    } catch { return false; }
  }
  return false;
}
