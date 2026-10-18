export const DOWNLOAD_RETRY_COOLDOWN_MS = 5 * 60_000;

export function downloadRetryAvailableAt(download: { createdAt: number; retryAfter: number }): number {
  return Math.max(download.createdAt + DOWNLOAD_RETRY_COOLDOWN_MS, download.retryAfter);
}
