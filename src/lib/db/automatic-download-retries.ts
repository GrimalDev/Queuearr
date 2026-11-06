import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { automaticDownloadRetries, monitoredDownloads } from '@/lib/db/schema';

export function clearSettledAutomaticDownloadRetries(): void {
  db.delete(automaticDownloadRetries).where(sql`exists (
    select 1 from ${monitoredDownloads} where ${monitoredDownloads.id} = ${automaticDownloadRetries.downloadId}
    and (${monitoredDownloads.completedAt} is not null or ${monitoredDownloads.lastStatus} in ('cancelled', 'cancelling'))
  )`).run();
}

export function clearAutomaticDownloadRetries(downloadId: number): void {
  db.delete(automaticDownloadRetries).where(eq(automaticDownloadRetries.downloadId, downloadId)).run();
}

export function getAutomaticDownloadRetry(key: string): typeof automaticDownloadRetries.$inferSelect | undefined {
  return db.select().from(automaticDownloadRetries).where(eq(automaticDownloadRetries.key, key)).get();
}

/** A recovered transfer disappears; a manual retry or new request restarts the timer. */
export function observeAutomaticDownloadFailures(downloadId: number, keys: string[], retryDeadline: number): void {
  db.transaction(() => {
    db.delete(automaticDownloadRetries).where(and(eq(automaticDownloadRetries.downloadId, downloadId),
      keys.length ? notInArray(automaticDownloadRetries.key, keys) : undefined)).run();
    for (const key of keys) {
      const prior = getAutomaticDownloadRetry(key);
      if (prior?.retryDeadline === retryDeadline) continue;
      db.insert(automaticDownloadRetries).values({ key, downloadId, retryDeadline, failedAt: Date.now() })
        .onConflictDoUpdate({ target: automaticDownloadRetries.key, set: { retryDeadline, failedAt: Date.now() } }).run();
    }
  });
}
