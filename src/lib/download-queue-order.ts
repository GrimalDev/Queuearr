import type { QueueItem } from '@/types';

/** Active transfers first; oldest transfer/request first within each group. */
export function orderDownloadQueue(items: QueueItem[], retryingIds: ReadonlySet<string>): QueueItem[] {
  const priority = (item: QueueItem): number => {
    if (retryingIds.has(item.id)) return 2;
    if (item.hasError || item.isStalled || item.status === 'failed' || item.status === 'warning') return 2;
    if (!item.isSearching && item.status === 'downloading') return 0;
    if (item.status === 'importing') return 1;
    if (item.status === 'completed' || item.status === 'seeding') return 4;
    return 3;
  };
  const timestamp = (item: QueueItem): number => {
    // Transmission timestamps use seconds; Queuearr request timestamps use milliseconds.
    if (item.startDate && item.startDate > 0) return item.startDate * 1000;
    if (item.addedDate && item.addedDate > 0) return item.addedDate * 1000;
    if (item.dbCreatedAt && item.dbCreatedAt > 0) return item.dbCreatedAt;
    return Number.POSITIVE_INFINITY;
  };
  return [...items].sort((left, right) => priority(left) - priority(right) ||
    timestamp(left) - timestamp(right) || left.id.localeCompare(right.id));
}
