import { eq, and, isNull } from 'drizzle-orm';
import { db } from './index';
import { monitoredDownloads, monitoredDownloadUsers } from './schema';
import type { MonitoredDownload } from './schema';

export async function upsertMonitoredDownload(
  source: 'radarr' | 'sonarr',
  mediaId: number,
  title: string
): Promise<MonitoredDownload> {
  const now = Date.now();

  await db
    .insert(monitoredDownloads)
    .values({ source, mediaId, title, createdAt: now })
    .onConflictDoNothing();

  const existing = await db.query.monitoredDownloads.findFirst({
    where: and(
      eq(monitoredDownloads.source, source),
      eq(monitoredDownloads.mediaId, mediaId)
    ),
  });

  return existing!;
}

export async function addUserToDownload(downloadId: number, userId: string): Promise<void> {
  await db
    .insert(monitoredDownloadUsers)
    .values({ downloadId, userId })
    .onConflictDoNothing();
}

export interface ActiveMonitoredDownload {
  id: number;
  source: string;
  mediaId: number;
  title: string;
  lastStatus: string | null;
  userIds: string[];
}

export async function getActiveMonitoredDownloads(): Promise<ActiveMonitoredDownload[]> {
  const rows = await db
    .select({
      id: monitoredDownloads.id,
      source: monitoredDownloads.source,
      mediaId: monitoredDownloads.mediaId,
      title: monitoredDownloads.title,
      lastStatus: monitoredDownloads.lastStatus,
      userId: monitoredDownloadUsers.userId,
    })
    .from(monitoredDownloads)
    .leftJoin(
      monitoredDownloadUsers,
      eq(monitoredDownloads.id, monitoredDownloadUsers.downloadId)
    )
    .where(isNull(monitoredDownloads.completedAt));

  const map = new Map<number, ActiveMonitoredDownload>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        source: row.source,
        mediaId: row.mediaId,
        title: row.title,
        lastStatus: row.lastStatus,
        userIds: [],
      });
    }
    if (row.userId) {
      map.get(row.id)!.userIds.push(row.userId);
    }
  }

  return Array.from(map.values());
}

export async function getActiveMediaIds(source: 'radarr' | 'sonarr'): Promise<Map<number, number>> {
  const rows = await db
    .select({ mediaId: monitoredDownloads.mediaId, id: monitoredDownloads.id })
    .from(monitoredDownloads)
    .where(and(eq(monitoredDownloads.source, source), isNull(monitoredDownloads.completedAt)));

  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.mediaId, row.id);
  }
  return map;
}

export async function isUserWatching(downloadId: number, userId: string): Promise<boolean> {
  const row = await db.query.monitoredDownloadUsers.findFirst({
    where: and(
      eq(monitoredDownloadUsers.downloadId, downloadId),
      eq(monitoredDownloadUsers.userId, userId)
    ),
  });
  return !!row;
}

export async function removeUserFromDownload(downloadId: number, userId: string): Promise<void> {
  await db
    .delete(monitoredDownloadUsers)
    .where(
      and(
        eq(monitoredDownloadUsers.downloadId, downloadId),
        eq(monitoredDownloadUsers.userId, userId)
      )
    );
}

export async function getMonitoredDownloadBySourceMedia(
  source: 'radarr' | 'sonarr',
  mediaId: number
): Promise<MonitoredDownload | undefined> {
  return db.query.monitoredDownloads.findFirst({
    where: and(
      eq(monitoredDownloads.source, source),
      eq(monitoredDownloads.mediaId, mediaId),
      isNull(monitoredDownloads.completedAt)
    ),
  });
}

export async function updateDownloadStatus(id: number, status: string): Promise<void> {
  await db
    .update(monitoredDownloads)
    .set({ lastStatus: status })
    .where(eq(monitoredDownloads.id, id));
}

export async function markDownloadCompleted(id: number): Promise<void> {
  await db
    .update(monitoredDownloads)
    .set({ completedAt: Date.now() })
    .where(eq(monitoredDownloads.id, id));
}
