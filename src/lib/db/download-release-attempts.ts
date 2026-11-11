import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { downloadReleaseAttempts } from '@/lib/db/schema';
import { readOwnedBlocklistIds, releaseIdentities, releaseTitleDigest, RELEASE_ROUND_COOLDOWN_MS } from '@/lib/download-release-rounds';
import type { Release } from '@/types';

export type DownloadReleaseAttempt = typeof downloadReleaseAttempts.$inferSelect;

export function getDownloadReleaseAttempts(downloadId: number): DownloadReleaseAttempt[] {
  return db.select().from(downloadReleaseAttempts).where(eq(downloadReleaseAttempts.downloadId, downloadId)).all();
}

export function reserveDownloadRelease(downloadId: number, cycleStartedAt: number, round: number, release: Release): void {
  for (const identity of releaseIdentities(release)) {
    const values = { downloadId, cycleStartedAt, identity, titleDigest: releaseTitleDigest(release.title), round, attemptedAt: Date.now(), kind: 'submitted' as const };
    db.insert(downloadReleaseAttempts).values(values).onConflictDoUpdate({
      target: [downloadReleaseAttempts.downloadId, downloadReleaseAttempts.cycleStartedAt, downloadReleaseAttempts.identity],
      set: { round, attemptedAt: values.attemptedAt },
    }).run();
  }
}

export function recordDownloadReleaseFailure(
  downloadId: number, cycleStartedAt: number, round: number, identities: string[], title: string,
  kind: 'temporary' | 'permanent' | 'unknown', ownedBlocklistIds: number[] = [],
): void {
  for (const identity of identities) {
    const prior = db.select().from(downloadReleaseAttempts).where(and(eq(downloadReleaseAttempts.downloadId, downloadId),
      eq(downloadReleaseAttempts.cycleStartedAt, cycleStartedAt), eq(downloadReleaseAttempts.identity, identity))).get();
    const protectedKind = prior && ['permanent', 'unknown'].includes(prior.kind) ? prior.kind : kind;
    const values = { downloadId, cycleStartedAt, identity, titleDigest: releaseTitleDigest(title), round,
      kind: protectedKind, attemptedAt: Date.now(), retryAt: Date.now() + RELEASE_ROUND_COOLDOWN_MS,
      ownedBlocklistIds: JSON.stringify([...new Set([...(prior ? readOwnedBlocklistIds(prior.ownedBlocklistIds) : []), ...ownedBlocklistIds])]) };
    db.insert(downloadReleaseAttempts).values(values).onConflictDoUpdate({
      target: [downloadReleaseAttempts.downloadId, downloadReleaseAttempts.cycleStartedAt, downloadReleaseAttempts.identity], set: values,
    }).run();
  }
}
