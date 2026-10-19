import type { Release, ReleaseSearchRetry, ReleaseSearchSummary } from '@/types';

/** Radarr can return partial results without failing the HTTP request. Confirm before giving up. */
export function releaseSearchRetry(previousFailures = 0): ReleaseSearchRetry {
  const failures = Math.min(3, Math.max(0, previousFailures) + 1);
  return { failures, confirming: failures < 3, delay: failures === 1 ? 60_000 : failures === 2 ? 5 * 60_000 : 15 * 60_000 };
}

/** Log decisions and indexer coverage without titles, signed URLs or raw rejection strings. */
export function summarizeReleaseSearch(releases: Release[]): ReleaseSearchSummary {
  const indexers = new Map<number | null, ReleaseSearchSummary['indexers'][number]>();
  for (const release of releases) {
    const indexerId = Number.isSafeInteger(release.indexerId) && release.indexerId > 0 ? release.indexerId : null;
    const entry = indexers.get(indexerId) ?? { indexerId, returned: 0, rejected: 0 };
    entry.returned++;
    if (release.downloadAllowed === false || release.rejections?.length) entry.rejected++;
    indexers.set(indexerId, entry);
  }
  const reasons = releases.flatMap((release) => release.rejections ?? []);
  return {
    returned: releases.length,
    rejected: releases.filter((release) => release.downloadAllowed === false || release.rejections?.length).length,
    quality: reasons.filter((reason) => /quality|profile|wanted/i.test(reason)).length,
    language: reasons.filter((reason) => /language|audio/i.test(reason)).length,
    customFormat: reasons.filter((reason) => /custom format|score/i.test(reason)).length,
    blocklisted: reasons.filter((reason) => /blocklist/i.test(reason)).length,
    indexers: [...indexers.values()].sort((a, b) => (a.indexerId ?? 0) - (b.indexerId ?? 0)),
  };
}
