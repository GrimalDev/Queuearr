import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { downloadRequests, monitoredDownloads, users } from '@/lib/db/schema';
import type { DownloadRequestAttribution, DownloadRequestScope } from '@/types';
import type { MonitoredDownload } from '@/lib/db/schema';

/** Called only when an explicit media selection is saved, never for followers or retries. */
export function recordDownloadRequest(download: MonitoredDownload, userId: string, scope: DownloadRequestScope): void {
  const user = db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('Download requester not found.');
  db.insert(downloadRequests).values({ downloadId: download.id, source: download.source, mediaId: download.mediaId,
    cycleStartedAt: download.createdAt, scope: JSON.stringify(scope), userId, username: user.username, requestedAt: Date.now(),
  }).onConflictDoNothing().run();
}

export function getDownloadRequestAttribution(downloadIds: number[]): Map<number, DownloadRequestAttribution[]> {
  const result = new Map<number, DownloadRequestAttribution[]>();
  for (let offset = 0; offset < downloadIds.length; offset += 500) {
    const rows = db.select({ downloadId: downloadRequests.downloadId, scope: downloadRequests.scope,
      userId: downloadRequests.userId, username: downloadRequests.username, requestedAt: downloadRequests.requestedAt,
    }).from(downloadRequests).innerJoin(monitoredDownloads, and(eq(downloadRequests.downloadId, monitoredDownloads.id),
      eq(downloadRequests.cycleStartedAt, monitoredDownloads.createdAt)))
      .where(inArray(downloadRequests.downloadId, downloadIds.slice(offset, offset + 500)))
      .orderBy(asc(downloadRequests.requestedAt), asc(downloadRequests.id)).all();
    for (const row of rows) result.set(row.downloadId, [...(result.get(row.downloadId) ?? []), {
      scope: JSON.parse(row.scope) as DownloadRequestScope, userId: row.userId,
      username: row.username ?? 'Unknown / external', requestedAt: row.requestedAt,
    }]);
  }
  return result;
}
