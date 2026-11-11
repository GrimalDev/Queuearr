import type { PendingQueueRequest, PendingQueueRetry, QueueItem } from '@/types';

export const QUEUE_RETRY_CONFIRMATION_MS = 60_000;

export function isRetriedQueueTransfer(item: QueueItem, original: QueueItem): boolean {
  if (item.source !== original.source || item.mediaId !== original.mediaId) return false;
  if (original.transmissionHash && item.transmissionHash) return item.transmissionHash.toLowerCase() === original.transmissionHash.toLowerCase();
  if (item.sourceId != null && original.sourceId != null) return item.sourceId === original.sourceId;
  if (!original.transmissionHash && item.transmissionHash && original.sourceId == null) return false;
  return item.id === original.id;
}

export function isQueueRetryConfirmed(items: QueueItem[], retry: PendingQueueRetry): boolean {
  if (retry.acceptedAt == null) return false;
  const related = items.filter((item) => item.source === retry.item.source && item.mediaId === retry.item.mediaId);
  const old = related.filter((item) => isRetriedQueueTransfer(item, retry.item));
  if (old.length) return old.some((item) => !item.hasError && !item.isStalled &&
    (item.isSearching || !!item.searchWaitingReason || item.audio?.phase === 'searching') &&
    (item.retryAvailableAt ?? 0) >= (retry.retryAvailableAt ?? 0));
  return related.some((item) => {
    if (retry.item.source !== 'sonarr' || item.id === `request-sonarr-${item.mediaId}`) return true;
    const episodes = retry.item.episodeIds ?? (retry.item.episodeId ? [retry.item.episodeId] : []);
    return (item.episodeIds ?? (item.episodeId ? [item.episodeId] : [])).some((id) => episodes.includes(id));
  });
}

/** Keep acknowledged retries visible while the upstream queue catches up. */
export function mergePendingQueueRetries(
  items: QueueItem[], retries: PendingQueueRetry[], userId: string | undefined, filter: 'mine' | 'all',
): QueueItem[] {
  let result = items;
  for (const retry of retries) {
    if (retry.userId !== userId || filter === 'mine' && retry.filter === 'all' || isQueueRetryConfirmed(items, retry)) continue;
    const searching: QueueItem = { ...retry.item, isRetryPending: true, isSearching: true, libraryReady: false,
      searchWaitingReason: undefined, nextAirAt: undefined,
      hasError: false, errorMessage: undefined, isStalled: false, status: 'pending', progress: 0, size: 0, sizeRemaining: 0,
      estimatedAudioLanguages: [], indexer: undefined, lifecyclePhase: undefined, isAwaitingDownload: false,
      retryAvailableAt: retry.retryAvailableAt ?? retry.item.retryAvailableAt,
      audio: retry.item.audio ? { ...retry.item.audio, phase: 'searching' } : undefined };
    const index = result.findIndex((item) => isRetriedQueueTransfer(item, retry.item));
    result = index >= 0 ? result.map((item, position) => position === index ? searching : item) : [...result, searching];
  }
  return result;
}

export function matchesQueueRequest(item: QueueItem, request: QueueItem): boolean {
  return item.source === request.source &&
    ((item.tmdbId != null && item.tmdbId === request.tmdbId) ||
      (item.mediaId != null && item.mediaId === request.mediaId));
}

export function mergePendingQueueRequests(items: QueueItem[], pending: PendingQueueRequest[], userId?: string): QueueItem[] {
  const visible = pending.filter((request) => request.userId === userId);
  const optimistic = visible.filter((request) => !request.accepted || !items.some((item) => matchesQueueRequest(item, request.item)));
  return [...optimistic.map((request) => request.item),
    ...items.filter((item) => !visible.some((request) => !request.accepted && matchesQueueRequest(item, request.item)))];
}
