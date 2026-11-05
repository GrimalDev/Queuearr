import type { DownloadSearchScope, SonarrEpisode, SonarrQueueItem } from '@/types';

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
  scopes: DownloadSearchScope[], episodes: SonarrEpisode[], queue: SonarrQueueItem[],
): DownloadSearchScope[] {
  const queued = new Set(queue.flatMap((item) => {
    const id = item.episodeId ?? item.episode?.id;
    return id ? [id] : [];
  }));
  // An unidentified pack may cover any episode. Wait rather than submit duplicates.
  if (queue.some((item) => !(item.episodeId ?? item.episode?.id))) return [];
  const covered = new Set<number>();
  const searches = scopes.flatMap((scope): DownloadSearchScope[] => {
    const selected = episodes.filter((episode) => episodeMatchesSearchScope(episode, scope) && !episode.hasFile);
    const missing = selected.filter((episode) => !queued.has(episode.id) && !covered.has(episode.id));
    if (!missing.length) return [];
    for (const episode of missing) covered.add(episode.id);
    return selected.length === missing.length ? [scope] : missing.map((episode) => ({ type: 'episode', episodeId: episode.id }));
  });
  return [...new Map(searches.map((scope) => [JSON.stringify(scope), scope])).values()];
}
