import type { DownloadInitiator, DownloadRequestAttribution, QueueItem } from '@/types';

export function getDownloadInitiator(item: QueueItem, requests: DownloadRequestAttribution[] = []): DownloadInitiator {
  const episodes = item.episodeIds ?? (item.episodeId ? [item.episodeId] : []);
  const relevant = item.source === 'sonarr' && (episodes.length || item.seasonNumber != null) ? requests.filter((request) => request.scope.type === 'series' ||
    request.scope.type === 'episode' && episodes.includes(request.scope.episodeId) ||
    request.scope.type === 'season' && item.seasonNumber === request.scope.seasonNumber) : requests;
  // Movie language additions start new work; episode requests retain their first initiator.
  const request = item.source === 'radarr' ? relevant.at(-1) : relevant[0];
  return request ? { userId: request.userId, username: request.username, requestedAt: request.requestedAt }
    : { userId: null, username: 'Unknown / external', requestedAt: null };
}
