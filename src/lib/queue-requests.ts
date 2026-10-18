import type { PendingQueueRequest, QueueItem } from '@/types';

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
