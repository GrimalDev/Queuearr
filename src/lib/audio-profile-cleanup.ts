import axios from 'axios';
import { createRadarrClient, type RadarrClient } from '@/lib/api/radarr';
import { acquireMovieAudioLock, getMovieAudioPolicies, releaseMovieAudioLock, renewMovieAudioLock } from '@/lib/db/movie-audio';
import { logMovieAudioError } from '@/lib/movie-audio-errors';
import { isUnmodifiedAudioProfile } from '@/lib/radarr-audio-profile';

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const RETRY_INTERVAL_MS = 5 * 60_000;
interface UnusedProfileObservation { name: string; since: number }
const cleanupState = globalThis as typeof globalThis & {
  queuearrAudioProfileCleanup?: Promise<void>;
  queuearrAudioProfileCleanupTimer?: ReturnType<typeof setInterval>;
  queuearrAudioProfileCleanupAfter?: number;
  queuearrUnusedAudioProfiles?: Map<number, UnusedProfileObservation>;
};

export async function removeUnusedAudioProfiles(
  client: RadarrClient, protectedIds: ReadonlySet<number>, signal: AbortSignal,
  observations: Map<number, UnusedProfileObservation>,
): Promise<number> {
  const [profiles, movies] = await Promise.all([client.getQualityProfiles(), client.getMovies()]);
  const used = new Set([...protectedIds, ...movies.map((movie) => movie.qualityProfileId)]);
  const unused = profiles.filter((profile) => !used.has(profile.id) && isUnmodifiedAudioProfile(profile));
  const candidates = new Set(unused.map((profile) => profile.id));
  for (const id of observations.keys()) if (!candidates.has(id)) observations.delete(id);
  let removed = 0;
  for (const profile of unused) {
    signal.throwIfAborted();
    const observation = observations.get(profile.id);
    if (observation?.name !== profile.name) {
      observations.set(profile.id, { name: profile.name, since: Date.now() });
      continue;
    }
    // Independent Queuearr installations may share Radarr but use separate DB locks.
    if (Date.now() - observation.since < CLEANUP_INTERVAL_MS) continue;
    try {
      // Refresh both ownership and assignment immediately before deletion.
      const [current, currentMovies] = await Promise.all([client.getQualityProfile(profile.id), client.getMovies()]);
      signal.throwIfAborted();
      if (current.name !== profile.name || !isUnmodifiedAudioProfile(current) ||
          currentMovies.some((movie) => movie.qualityProfileId === profile.id)) {
        observations.delete(profile.id);
        continue;
      }
      // Radarr also refuses profiles used by movies, import lists or collections.
      await client.deleteQualityProfile(profile.id);
      observations.delete(profile.id);
      removed++;
    } catch (cause) {
      const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;
      if (status === 404 || status === 400 || status === 409) {
        observations.delete(profile.id);
        continue;
      }
      throw cause;
    }
  }
  return removed;
}

async function runCleanup(): Promise<void> {
  const client = createRadarrClient();
  if (!client) return;
  // Hold the same cross-process lease as profile creation through movie assignment.
  const lock = acquireMovieAudioLock();
  if (!lock) return;
  const abort = new AbortController();
  const heartbeat = setInterval(() => {
    try { if (!renewMovieAudioLock(lock)) abort.abort(); }
    catch { abort.abort(); }
  }, 30_000);
  try {
    const protectedIds = new Set([...getMovieAudioPolicies().values()].map((policy) => policy.baseProfileId));
    const configured = Number(process.env.RADARR_QUALITY_PROFILE_ID);
    if (Number.isSafeInteger(configured) && configured > 0) protectedIds.add(configured);
    cleanupState.queuearrUnusedAudioProfiles ??= new Map();
    const removed = await removeUnusedAudioProfiles(client, protectedIds, abort.signal, cleanupState.queuearrUnusedAudioProfiles);
    if (removed) console.info(`[audio] Removed ${removed} unused managed Radarr audio profile(s).`);
    cleanupState.queuearrAudioProfileCleanupAfter = Date.now() + CLEANUP_INTERVAL_MS;
  } catch (cause) {
    logMovieAudioError('Radarr profile cleanup', cause);
    cleanupState.queuearrAudioProfileCleanupAfter = Date.now() + RETRY_INTERVAL_MS;
  } finally {
    clearInterval(heartbeat);
    releaseMovieAudioLock(lock);
  }
}

export function cleanupAudioProfiles(): Promise<void> {
  if (cleanupState.queuearrAudioProfileCleanup) return cleanupState.queuearrAudioProfileCleanup;
  if (Date.now() < (cleanupState.queuearrAudioProfileCleanupAfter ?? 0)) return Promise.resolve();
  cleanupState.queuearrAudioProfileCleanup = runCleanup().catch((cause) => {
    logMovieAudioError('Radarr profile cleanup', cause);
    cleanupState.queuearrAudioProfileCleanupAfter = Date.now() + RETRY_INTERVAL_MS;
  }).finally(() => {
    cleanupState.queuearrAudioProfileCleanup = undefined;
  });
  return cleanupState.queuearrAudioProfileCleanup;
}

export function startAudioProfileCleanup(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || cleanupState.queuearrAudioProfileCleanupTimer) return;
  void cleanupAudioProfiles();
  cleanupState.queuearrAudioProfileCleanupTimer = setInterval(() => void cleanupAudioProfiles(), RETRY_INTERVAL_MS);
  cleanupState.queuearrAudioProfileCleanupTimer.unref();
}
