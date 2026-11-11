import { createHash } from 'node:crypto';
import type { Release, ReleaseBlocklistEntry } from '@/types';
import type { DownloadReleaseAttempt } from '@/lib/db/download-release-attempts';

export const RELEASE_ROUND_COOLDOWN_MS = 30 * 60_000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function releaseTitleDigest(title: string): string {
  return digest(title.normalize('NFKC').toLowerCase().replace(/\.(mkv|mp4|avi)$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
}

export function releaseHash(value?: string): string | undefined {
  return value && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value) ? value.toLowerCase() : undefined;
}

export function releaseGuidIdentity(guid: string): string {
  return `guid:${digest(guid)}`;
}

/** GUIDs can contain credentials. Persist only their digest. */
export function releaseIdentities(release: Release): string[] {
  let hash = releaseHash(release.infoHash);
  if (!hash && release.magnetUrl) {
    try { hash = releaseHash(new URL(release.magnetUrl).searchParams.get('xt')?.replace(/^urn:btih:/i, '')); } catch { /* Unknown identity stays excluded from blocklist overrides. */ }
  }
  return [...(hash ? [`hash:${hash}`] : []), releaseGuidIdentity(release.guid)];
}

export function readOwnedBlocklistIds(value: string): number[] {
  const ids: unknown = JSON.parse(value);
  if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid saved release blocklist IDs.');
  return ids as number[];
}

export interface ReleaseRoundSelection {
  candidate?: Release;
  round: number;
  nextRoundAt: number;
  resumed: boolean;
}

export function selectReleaseForRound(
  releases: Release[], attempts: DownloadReleaseAttempt[], cycleStartedAt: number,
  round: number, nextRoundAt: number, blocklist: ReleaseBlocklistEntry[] | null, now = Date.now(),
): ReleaseRoundSelection {
  const current = attempts.filter((attempt) => attempt.cycleStartedAt === cycleStartedAt);
  const knownBlockIds = new Set(attempts.flatMap((attempt) => readOwnedBlocklistIds(attempt.ownedBlocklistIds)));
  const ranked = [...releases].sort((a, b) => {
    const seeders = (value?: number): number => Number.isFinite(value) ? Math.max(0, value!) : 0;
    return seeders(b.seeders) - seeders(a.seeders) || (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) ||
      (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0) || a.guid.localeCompare(b.guid);
  });
  const candidates = ranked.flatMap((release) => {
    const identities = releaseIdentities(release);
    const title = releaseTitleDigest(release.title);
    const matching = attempts.filter((attempt) => identities.includes(attempt.identity) || attempt.titleDigest === title);
    if (matching.some((attempt) => ['permanent', 'unknown'].includes(attempt.kind))) return [];
    const previous = current.filter((attempt) => identities.includes(attempt.identity) || attempt.titleDigest === title);
    // An unconfirmed submission must never become an automatic second grab.
    if (previous.some((attempt) => attempt.kind === 'submitted')) return [];
    const temporary = previous.filter((attempt) => attempt.kind === 'temporary' && identities.includes(attempt.identity));
    if (previous.length && !temporary.length) return [];
    const rejections = release.rejections ?? [];
    const matchingBlocks = blocklist?.filter((entry) => releaseTitleDigest(entry.sourceTitle) === title) ?? [];
    if (rejections.length || release.downloadAllowed === false || matchingBlocks.length) {
      // Only this exact rejection may be bypassed, for this request's verified temporary failure.
      if ((!rejections.length && !matchingBlocks.length) || rejections.some((reason) => !/^(?:release|torrent) is (?:blocklisted|blacklisted)[.!]?$/i.test(reason.trim())) ||
          !temporary.length || blocklist === null || blocklist.some((entry) => !knownBlockIds.has(entry.id))) return [];
      const owned = new Set(temporary.flatMap((attempt) => readOwnedBlocklistIds(attempt.ownedBlocklistIds)));
      if (!matchingBlocks.length || matchingBlocks.some((entry) => !owned.has(entry.id))) return [];
    }
    return [{ release, previous, temporary }];
  });
  const untried = candidates.find(({ previous, temporary }) =>
    (!previous.length || previous.every((attempt) => attempt.round < round)) && temporary.every((attempt) => attempt.retryAt <= now));
  if (untried) {
    return { candidate: untried.release, round, nextRoundAt: 0, resumed: false };
  }
  const exhausted = candidates.filter(({ temporary }) => temporary.length > 0);
  if (!exhausted.length) return { round, nextRoundAt: 0, resumed: false };
  const readyAt = Math.max(nextRoundAt || now + RELEASE_ROUND_COOLDOWN_MS,
    Math.min(...exhausted.map(({ temporary }) => Math.max(...temporary.map((attempt) => attempt.retryAt)))));
  if (now < readyAt) return { round, nextRoundAt: readyAt, resumed: false };
  const retry = exhausted.find(({ temporary }) => temporary.every((attempt) => attempt.retryAt <= now));
  return retry ? { candidate: retry.release, round: round + 1, nextRoundAt: 0, resumed: true }
    : { round, nextRoundAt: readyAt, resumed: false };
}
