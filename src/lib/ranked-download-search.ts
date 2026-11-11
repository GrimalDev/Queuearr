import type { SonarrClient } from '@/lib/api/sonarr';
import type { RadarrClient } from '@/lib/api/radarr';
import { resetMonitoredDownload, type ActiveMonitoredDownload } from '@/lib/db/monitored-downloads';
import axios from 'axios';
import { db } from '@/lib/db';
import { getDownloadReleaseAttempts, recordDownloadReleaseFailure, reserveDownloadRelease } from '@/lib/db/download-release-attempts';
import { updateDownloadSearchJob, type DownloadSearchJob } from '@/lib/db/download-search-jobs';
import { releaseIdentities, selectReleaseForRound, type ReleaseRoundSelection } from '@/lib/download-release-rounds';
import { invalidateQueueCache } from '@/lib/queue-cache';
import type { DownloadSearchScope, Release, ReleaseBlocklistEntry, SonarrEpisode, SonarrQueueItem } from '@/types';
import { episodeMatchesSearchScope } from '@/lib/sonarr-search-scopes';
import { getDownloadFileFailureReason } from '@/lib/automatic-retry-policy';

/** A verified file rejection can advance to another source; ambiguous POST failures require review. */
export async function recoverRejectedRelease(
  job: DownloadSearchJob, download: ActiveMonitoredDownload, client: RadarrClient | SonarrClient,
  candidate: Release, round: number, episodeIds: number[], cause: unknown,
): Promise<boolean> {
  if (!axios.isAxiosError<unknown>(cause) || cause.response?.status !== 409) return false;
  const data = cause.response.data;
  const reason = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
    ? getDownloadFileFailureReason({ errorMessage: data.message }) : undefined;
  if (!reason) return false;
  const records = (await client.getQueue()).records;
  if (records.some((item) => download.source === 'radarr' ? 'movieId' in item && item.movieId === download.mediaId :
    'seriesId' in item && item.seriesId === download.mediaId &&
      (!('episodeId' in item) || !item.episodeId || episodeIds.includes(item.episodeId)))) return false;
  recordDownloadReleaseFailure(download.id, download.createdAt, round, releaseIdentities(candidate), candidate.title, 'permanent');
  updateDownloadSearchJob(job.downloadId, { rankedSearch: true, state: 'pending', pendingEpisodeIds: null, submittedAt: null,
    searchFailures: 0, nextAttemptAt: Date.now() + 30_000 });
  await resetMonitoredDownload(download.id, reason);
  return true;
}

/** Fail closed for ambiguous mappings and packs containing unrequested, imported, or future episodes. */
export function releaseEpisodeIds(release: Release, episodes: SonarrEpisode[], seriesId: number): number[] {
  if (release.mappedSeriesId != null && release.mappedSeriesId !== seriesId) return [];
  if (release.mappedEpisodeInfo?.length) {
    const ids = release.mappedEpisodeInfo.map((episode) => episode.id);
    return ids.every((id) => episodes.some((episode) => episode.id === id)) ? [...new Set(ids)] : [];
  }
  const season = release.mappedSeasonNumber ?? release.seasonNumber;
  const numbers = release.mappedEpisodeNumbers?.length ? release.mappedEpisodeNumbers : release.episodeNumbers;
  if (!Number.isSafeInteger(season)) return [];
  if (release.fullSeason) return episodes.filter((episode) => episode.seasonNumber === season).map((episode) => episode.id);
  if (!numbers?.length) return [];
  const mapped = numbers.map((number) => episodes.find((episode) => episode.seasonNumber === season && episode.episodeNumber === number)?.id);
  return mapped.every((id) => id !== undefined) ? [...new Set(mapped)] : [];
}

export async function chooseRankedRelease(
  job: DownloadSearchJob, download: ActiveMonitoredDownload, releases: Release[],
  getBlocklist: () => Promise<ReleaseBlocklistEntry[]>,
): Promise<ReleaseRoundSelection> {
  const attempts = getDownloadReleaseAttempts(download.id);
  // Read existing blocklist records only. No shared blocks are deleted or edited.
  const blocklist = await getBlocklist().catch(() => null);
  return selectReleaseForRound(releases, attempts, download.createdAt, job.releaseRound, job.nextRoundAt, blocklist);
}

export function waitForRankedRelease(job: DownloadSearchJob, selection: ReleaseRoundSelection): void {
  const failures = Math.min(5, job.searchFailures + 1);
  updateDownloadSearchJob(job.downloadId, { rankedSearch: true, state: 'waiting_for_release', submittedAt: null,
    pendingEpisodeIds: null, searchFailures: failures, nextRoundAt: selection.nextRoundAt,
    nextAttemptAt: selection.nextRoundAt || Date.now() + Math.min(6 * 60, 30 * 2 ** (failures - 1)) * 60_000,
    detail: selection.nextRoundAt ? 'All usable sources in this round were tried. After the cooldown, only verified temporary failures can be tried again.' :
      'No eligible release was selected. Unsafe, corrupt, manual and unknown blocks remain excluded. Searching will resume automatically.' });
}

/** Search one outstanding episode per tick so a missing early episode cannot starve later selections. */
export async function runRankedSonarrSearch(
  job: DownloadSearchJob, download: ActiveMonitoredDownload, client: SonarrClient,
  episodes: SonarrEpisode[], scopes: DownloadSearchScope[], queue: SonarrQueueItem[], leaseLost: () => boolean,
): Promise<void> {
  const pending = episodes.filter((episode) => !episode.hasFile && !(Date.parse(episode.airDateUtc ?? '') > Date.now()) &&
    scopes.some((scope) => episodeMatchesSearchScope(episode, scope)) &&
    !queue.some((item) => (item.episodeId ?? item.episode?.id) === episode.id));
  if (!pending.length) return;
  const target = pending[job.searchCursor % pending.length];
  updateDownloadSearchJob(job.downloadId, { rankedSearch: true, searchCursor: job.searchCursor + 1 });
  const allowed = new Set(pending.map((episode) => episode.id));
  const releases = (await client.getReleases(target.id)).filter((release) => {
    const ids = releaseEpisodeIds(release, episodes, download.mediaId);
    return ids.includes(target.id) && ids.every((id) => allowed.has(id));
  });
  const selection = await chooseRankedRelease(job, download, releases, async () => {
    const relevant = new Set(pending.map((episode) => episode.id));
    return (await client.getBlocklist(download.mediaId)).filter((entry) => !entry.episodeIds?.length || entry.episodeIds.some((id) => relevant.has(id)));
  });
  if (!selection.candidate) {
    waitForRankedRelease(job, selection);
    // Finish a bounded pass over the other requested episodes before backing off the title.
    if ((job.searchCursor + 1) % pending.length !== 0) updateDownloadSearchJob(job.downloadId, { nextAttemptAt: Date.now() + 30_000 });
    return;
  }
  const candidate = selection.candidate;
  const ids = releaseEpisodeIds(candidate, episodes, download.mediaId);
  const freshQueue = (await client.getQueue()).records.filter((item) => item.seriesId === download.mediaId);
  const freshEpisodes = await client.getEpisodes(download.mediaId);
  if (freshQueue.some((item) => !(item.episodeId ?? item.episode?.id) || ids.includes((item.episodeId ?? item.episode?.id)!)) ||
      freshEpisodes.some((episode) => ids.includes(episode.id) && (episode.hasFile || Date.parse(episode.airDateUtc ?? '') > Date.now()))) {
    updateDownloadSearchJob(job.downloadId, { state: 'downloading', submittedAt: null, nextAttemptAt: Date.now() + 30_000 });
    return;
  }
  if (leaseLost()) return;
  db.transaction(() => {
    reserveDownloadRelease(download.id, download.createdAt, selection.round, candidate);
    updateDownloadSearchJob(job.downloadId, { rankedSearch: true, releaseRound: selection.round, nextRoundAt: 0,
      state: 'grab_pending', submittedAt: Date.now(), pendingEpisodeIds: JSON.stringify(ids), searchFailures: 0,
      indexer: candidate.indexer || `Indexer ${candidate.indexerId}`, estimatedLanguages: JSON.stringify(candidate.languages ?? []),
      detail: null, nextAttemptAt: Date.now() + 30_000 });
  });
  try { await client.grabRelease(candidate.guid, candidate.indexerId); }
  catch (cause) {
    if (!await recoverRejectedRelease(job, download, client, candidate, selection.round, ids, cause)) throw cause;
  }
  finally { invalidateQueueCache(['sonarr-queue']); }
}
