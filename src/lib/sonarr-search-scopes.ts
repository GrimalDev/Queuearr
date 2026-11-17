import type { DownloadSearchScope, SonarrEpisode, SonarrQueueItem } from '@/types';

export function sonarrQueueItemCoversEpisode(item: SonarrQueueItem, episode: SonarrEpisode): boolean {
  const id = item.episodeId ?? item.episode?.id;
  if (id) return id === episode.id;
  const season = item.episode?.seasonNumber ?? item.seasonNumber;
  // A pack with a known season must not block unrelated seasons.
  return season == null || season === episode.seasonNumber;
}

export function activeSonarrSearchScopes(job: { state: string; scopes: string; submittedAt: number | null; pendingEpisodeIds?: string | null } | undefined): DownloadSearchScope[] {
  if (!job) return [];
  if (job.state === 'needs_review' && job.submittedAt !== null) {
    return JSON.parse(job.scopes) as DownloadSearchScope[];
  }
  return ['pending', 'searching', 'downloading', 'grab_pending', 'waiting_for_airdate', 'waiting_for_release'].includes(job.state)
    ? JSON.parse(job.scopes) as DownloadSearchScope[] : [];
}

/** Preserve the array response while exposing activity for each individual episode. */
export function withSonarrEpisodeActivity(episodes: SonarrEpisode[], queue: SonarrQueueItem[], scopes: DownloadSearchScope[]): SonarrEpisode[] {
  return episodes.map((episode) => {
    const isDownloading = !episode.hasFile && queue.some((item) => sonarrQueueItemCoversEpisode(item, episode));
    return { ...episode, isDownloading, isSearching: !episode.hasFile && !isDownloading &&
      scopes.some((scope) => episodeMatchesSearchScope(episode, scope)) };
  });
}

export function sonarrQueueItemMatchesScope(item: SonarrQueueItem, scope: DownloadSearchScope): boolean {
  return scope.type === 'series' && item.episode?.monitored !== false ||
    scope.type === 'season' && (item.episode?.seasonNumber ?? item.seasonNumber) === scope.seasonNumber ||
    scope.type === 'episode' && (item.episodeId ?? item.episode?.id) === scope.episodeId;
}

export function episodeMatchesSearchScope(episode: SonarrEpisode, scope: DownloadSearchScope): boolean {
  return scope.type === 'series' && episode.monitored === true ||
    scope.type === 'season' && episode.seasonNumber === scope.seasonNumber ||
    scope.type === 'episode' && episode.id === scope.episodeId;
}

/** Sonarr removes a whole transfer, including every queue row of a season pack. */
export function getSonarrRetryItems(queue: SonarrQueueItem[], ids: number[]): SonarrQueueItem[] {
  const selected = queue.filter((item) => ids.includes(item.id));
  const hashes = new Set(selected.flatMap((item) => item.downloadId ? [item.downloadId.toLowerCase()] : []));
  return queue.filter((item) => ids.includes(item.id) || !!item.downloadId && hashes.has(item.downloadId.toLowerCase()));
}

/** Search missing episodes without waiting for unrelated transfers in the series. */
export function getUnqueuedSonarrSearchScopes(
  scopes: DownloadSearchScope[], episodes: SonarrEpisode[], queue: SonarrQueueItem[], now = Date.now(),
): DownloadSearchScope[] {
  const covered = new Set<number>();
  const searches = scopes.flatMap((scope): DownloadSearchScope[] => {
    const selected = episodes.filter((episode) => episodeMatchesSearchScope(episode, scope) && !episode.hasFile);
    const missing = selected.filter((episode) => !queue.some((item) => sonarrQueueItemCoversEpisode(item, episode)) && !covered.has(episode.id) &&
      !(Date.parse(episode.airDateUtc ?? '') > now));
    if (!missing.length) return [];
    for (const episode of missing) covered.add(episode.id);
    return selected.length === missing.length ? [scope] : missing.map((episode) => ({ type: 'episode', episodeId: episode.id }));
  });
  return [...new Map(searches.map((scope) => [JSON.stringify(scope), scope])).values()];
}
