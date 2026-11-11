import { isImportInProgress } from '@/lib/queue-retry-safety';
import type { DownloadRestartReason } from '@/types';

interface FileFailureEvidence {
  errorMessage?: string;
  statusMessages?: { messages: string[] }[];
}

function fileFailureMessages(item: FileFailureEvidence): string {
  return [item.errorMessage, ...(item.statusMessages ?? []).flatMap((status) => status.messages)].filter(Boolean).join('\n');
}

export const AUTOMATIC_RETRY_GRACE_MS = 5 * 60_000;

export function automaticRetryAt(failedAt: number, retryDeadline: number): number {
  return Math.max(failedAt, retryDeadline) + AUTOMATIC_RETRY_GRACE_MS;
}

export function automaticSearchRetryKey(downloadId: number, attempt: number): string {
  return `${downloadId}:search:${attempt}`;
}

/** Use the service's file warning, never a filename alone, to classify suspicious content. */
export function isSuspiciousDownload(item: FileFailureEvidence): boolean {
  return /\b(?:found|contains?|detected)\s+(?:an?\s+)?(?:executable|potentially dangerous|suspicious)\s+files?\b/i.test(fileFailureMessages(item));
}

/** Another release cannot repair a full disk, permissions, or a read-only mount. */
export function isLocalStorageFailure(item: FileFailureEvidence): boolean {
  return /\b(?:not enough (?:free |disk )?space|no space left on device|disk (?:is )?full|disk quota exceeded|insufficient (?:disk |free )?space|permission denied|access (?:is )?denied|read.only (?:file\s?system|filesystem)|ENOSPC|EDQUOT|EACCES|EPERM|EROFS|access to (?:the )?path[^\n]*denied|path[^\n]*(?:does not exist|not accessible))\b/i.test(fileFailureMessages(item));
}

export function getDownloadFileFailureReason(item: FileFailureEvidence): DownloadRestartReason | undefined {
  if (isLocalStorageFailure(item)) return undefined;
  if (isSuspiciousDownload(item)) return 'suspicious_files';
  const message = fileFailureMessages(item);
  const file = '(?:files?|archives?|video|media|container)';
  const invalid = '(?:corrupt(?:ed)?|damaged|invalid|unreadable|unsupported|missing)';
  return new RegExp(`\\b${invalid}\\b[^\\n]*\\b${file}\\b|\\b${file}\\b[^\\n]*\\b${invalid}\\b`, 'i').test(message) ||
    /\b(?:no (?:video |media )?files (?:were )?found|no files found are eligible for import|file (?:does not exist|not found)|(?:unable|failed) to (?:parse|read|probe|decode|extract)\b[^\n]*(?:file|archive|video|media)|(?:CRC|checksum) (?:failed|error|mismatch)|(?:password.protected|encrypted) archive|archive[^\n]*(?:password.protected|encrypted)|found (?:an? )?(?:compressed )?archive file|not a valid (?:video|media) file|sample file|file is a sample)\b/i.test(message)
    ? 'file_error' : undefined;
}

export function getDownloadRestartReason(items: FileFailureEvidence[]): DownloadRestartReason | null {
  const reasons = items.map(getDownloadFileFailureReason);
  return reasons.includes('suspicious_files') ? 'suspicious_files' : reasons.includes('file_error') ? 'file_error' : null;
}

export function isAutomaticRetryFailure(item: {
  status: string; trackedDownloadState?: string; trackedDownloadStatus?: string; errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
}): boolean {
  if (isImportInProgress(item) || isLocalStorageFailure(item)) return false;
  return !!getDownloadFileFailureReason(item) || ['failed', 'error'].includes(item.status.toLowerCase()) ||
    ['downloadfailed', 'failedpending', 'importblocked', 'importfailed'].includes(item.trackedDownloadState?.toLowerCase() ?? '') ||
    item.trackedDownloadStatus?.toLowerCase() === 'error' || !!item.errorMessage?.trim() ||
    item.trackedDownloadState?.toLowerCase() === 'importpending' && item.trackedDownloadStatus?.toLowerCase() === 'warning' &&
      !!item.statusMessages?.some((message) => message.title.trim() || message.messages.some((detail) => detail.trim()));
}
