import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { movieAudioJobs, movieAudioLocks, movieAudioPolicies, downloadSearchJobs } from '@/lib/db/schema';
import type { RadarrLanguage } from '@/types';
import { saveTrackedRequest } from '@/lib/db/monitored-downloads';

export interface MovieAudioPolicy {
  tmdbId: number;
  radarrMovieId: number;
  baseProfileId: number;
  requiredLanguages: RadarrLanguage[];
  explicitLanguageRequests?: boolean;
}

export function getMovieAudioPolicies(): Map<number, MovieAudioPolicy> {
  return new Map(db.select().from(movieAudioPolicies).all().map((row) => [row.tmdbId, {
    ...row,
    requiredLanguages: JSON.parse(row.requiredLanguages) as RadarrLanguage[],
  }]));
}

export function saveMovieAudioPolicy(policy: MovieAudioPolicy): void {
  const row = { ...policy, explicitLanguageRequests: policy.explicitLanguageRequests ?? true,
    requiredLanguages: JSON.stringify(policy.requiredLanguages) };
  db.insert(movieAudioPolicies).values(row).onConflictDoUpdate({
    target: movieAudioPolicies.tmdbId, set: row,
  }).run();
}

export function acquireMovieAudioLock(id = 1): string | null {
  const owner = randomUUID();
  const now = Date.now();
  const row = db.insert(movieAudioLocks).values({ id, owner, expiresAt: now + 300_000 })
    .onConflictDoUpdate({
      target: movieAudioLocks.id,
      set: { owner, expiresAt: now + 300_000 },
      setWhere: lt(movieAudioLocks.expiresAt, now),
    }).returning().get();
  return row?.owner === owner ? owner : null;
}

export function releaseMovieAudioLock(owner: string): void {
  db.delete(movieAudioLocks).where(eq(movieAudioLocks.owner, owner)).run();
}

export function renewMovieAudioLock(owner: string): boolean {
  return db.update(movieAudioLocks).set({ expiresAt: Date.now() + 300_000 })
    .where(eq(movieAudioLocks.owner, owner)).run().changes === 1;
}

export type MovieAudioJob = typeof movieAudioJobs.$inferSelect;

export function getMovieAudioJobs(): MovieAudioJob[] {
  return db.select().from(movieAudioJobs).all();
}

export function updateMovieAudioJob(tmdbId: number, changes: Partial<Omit<MovieAudioJob, 'tmdbId'>>): void {
  const values = { ...changes, updatedAt: Date.now() };
  db.insert(movieAudioJobs).values({ tmdbId, ...values }).onConflictDoUpdate({
    target: movieAudioJobs.tmdbId, set: values,
  }).run();
}

export function saveTrackedMovieAudioRequest(policy: MovieAudioPolicy, changes: Partial<Omit<MovieAudioJob, 'tmdbId'>>,
  title: string, userId: string): void {
  db.transaction(() => {
    const tracked = saveTrackedRequest('radarr', policy.radarrMovieId, title, userId);
    db.update(downloadSearchJobs).set({ state: 'cancelled', updatedAt: Date.now() }).where(eq(downloadSearchJobs.downloadId, tracked.id)).run();
    saveMovieAudioPolicy(policy);
    updateMovieAudioJob(policy.tmdbId, changes);
  });
}
