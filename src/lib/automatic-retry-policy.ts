import { isImportInProgress } from '@/lib/queue-retry-safety';

export const AUTOMATIC_RETRY_GRACE_MS = 5 * 60_000;

export function automaticRetryAt(failedAt: number, retryDeadline: number): number {
  return Math.max(failedAt, retryDeadline) + AUTOMATIC_RETRY_GRACE_MS;
}

export function automaticSearchRetryKey(downloadId: number, attempt: number): string {
  return `${downloadId}:search:${attempt}`;
}

export function isAutomaticRetryFailure(item: {
  status: string; trackedDownloadState?: string; trackedDownloadStatus?: string; errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
}): boolean {
  if (isImportInProgress(item)) return false;
  return ['failed', 'error'].includes(item.status.toLowerCase()) ||
    ['downloadfailed', 'failedpending', 'importblocked', 'importfailed'].includes(item.trackedDownloadState?.toLowerCase() ?? '') ||
    item.trackedDownloadStatus?.toLowerCase() === 'error' || !!item.errorMessage?.trim() ||
    item.trackedDownloadState?.toLowerCase() === 'importpending' && item.trackedDownloadStatus?.toLowerCase() === 'warning' &&
      !!item.statusMessages?.some((message) => message.title.trim() || message.messages.some((detail) => detail.trim()));
}
