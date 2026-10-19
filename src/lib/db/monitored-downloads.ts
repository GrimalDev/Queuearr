import { eq, and, isNull, desc, or, gte, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { monitoredDownloads, monitoredDownloadUsers, downloadTransfers } from '@/lib/db/schema';
import type { MonitoredDownload } from '@/lib/db/schema';
import { DOWNLOAD_RETRY_COOLDOWN_MS } from '@/lib/download-retry-policy';

export async function upsertMonitoredDownload(
  source: 'radarr' | 'sonarr',
  mediaId: number,
  title: string
): Promise<MonitoredDownload> {
  const now = Date.now();

  await db
    .insert(monitoredDownloads)
    .values({ source, mediaId, title, createdAt: now, lastActivityAt: now, lastBytesAt: now })
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

/** Use inside a transaction with its worker job, before submitting external work. */
export function saveTrackedRequest(source: 'radarr' | 'sonarr', mediaId: number, title: string, userId: string): MonitoredDownload {
  const now = Date.now();
  const prior = db.select().from(monitoredDownloads).where(and(eq(monitoredDownloads.source, source), eq(monitoredDownloads.mediaId, mediaId))).get();
  if (prior?.lastStatus === 'cancelling') throw new Error('Finish cancelling this download before submitting a new request.');
  const row = db.insert(monitoredDownloads).values({ source, mediaId, title, createdAt: now, lastActivityAt: now, lastBytesAt: now,
    retryAfter: now + DOWNLOAD_RETRY_COOLDOWN_MS })
    .onConflictDoUpdate({ target: [monitoredDownloads.source, monitoredDownloads.mediaId], set: {
      title, completedAt: null, lastStatus: null, lastActivityAt: now, lastBytesAt: now,
      retryAfter: Math.max(prior?.retryAfter ?? 0, now + DOWNLOAD_RETRY_COOLDOWN_MS),
      ...(prior?.completedAt != null ? { createdAt: now } : {}),
    } }).returning().get();
  if (prior?.completedAt != null) db.delete(downloadTransfers).where(eq(downloadTransfers.downloadId, row.id)).run();
  db.insert(monitoredDownloadUsers).values({ downloadId: row.id, userId }).onConflictDoNothing().run();
  return row;
}

export async function reopenMonitoredDownload(
  source: 'radarr' | 'sonarr', mediaId: number, title: string,
): Promise<MonitoredDownload> {
  const download = await upsertMonitoredDownload(source, mediaId, title);
  if (download.completedAt !== null) {
    const now = Date.now();
    db.delete(downloadTransfers).where(eq(downloadTransfers.downloadId, download.id)).run();
    await db.update(monitoredDownloads).set({
      completedAt: null, lastStatus: null, createdAt: now, lastActivityAt: now, lastBytesAt: now,
    }).where(eq(monitoredDownloads.id, download.id));
  }
  return download;
}

export interface ActiveMonitoredDownload {
  id: number;
  source: string;
  mediaId: number;
  title: string;
  lastStatus: string | null;
  createdAt: number;
  completedAt?: number | null;
  lastActivityAt: number | null;
  lastBytesAt: number | null;
  userIds: string[];
}

export async function getActiveMonitoredDownloadsForUser(userId: string): Promise<ActiveMonitoredDownload[]> {
  return listMonitoredDownloads(userId);
}

/** Keep up to 100 recent completed requests visible for 24 hours, plus every active request. */
export async function getQueueMonitoredDownloads(userId?: string): Promise<ActiveMonitoredDownload[]> {
  return listMonitoredDownloads(userId, true);
}

export async function getWatchedMediaIds(userId: string, source: 'radarr' | 'sonarr', includeCompleted = false): Promise<Set<number>> {
  const rows = await db
    .select({ mediaId: monitoredDownloads.mediaId })
    .from(monitoredDownloads)
    .innerJoin(
      monitoredDownloadUsers,
      eq(monitoredDownloads.id, monitoredDownloadUsers.downloadId)
    )
    .where(
      and(
        eq(monitoredDownloads.source, source),
        eq(monitoredDownloadUsers.userId, userId),
        includeCompleted ? undefined : isNull(monitoredDownloads.completedAt)
      )
    );

  return new Set(rows.map((r) => r.mediaId));
}

export async function getActiveMonitoredDownloads(): Promise<ActiveMonitoredDownload[]> {
  return listMonitoredDownloads();
}

async function listMonitoredDownloads(userId?: string, includeRecent = false): Promise<ActiveMonitoredDownload[]> {
  const rows = await db.select({
    id: monitoredDownloads.id, source: monitoredDownloads.source, mediaId: monitoredDownloads.mediaId,
    title: monitoredDownloads.title, lastStatus: monitoredDownloads.lastStatus, createdAt: monitoredDownloads.createdAt,
    completedAt: monitoredDownloads.completedAt, lastActivityAt: monitoredDownloads.lastActivityAt,
    lastBytesAt: monitoredDownloads.lastBytesAt, userId: monitoredDownloadUsers.userId,
  }).from(monitoredDownloads).leftJoin(monitoredDownloadUsers, eq(monitoredDownloads.id, monitoredDownloadUsers.downloadId))
    .where(and(userId ? eq(monitoredDownloadUsers.userId, userId) : undefined,
      includeRecent ? or(isNull(monitoredDownloads.completedAt), and(
        gte(monitoredDownloads.completedAt, Date.now() - 24 * 60 * 60_000),
        or(isNull(monitoredDownloads.lastStatus), ne(monitoredDownloads.lastStatus, 'cancelled')),
      )) : isNull(monitoredDownloads.completedAt)))
    .orderBy(desc(monitoredDownloads.completedAt)).all();
  const grouped = new Map<number, ActiveMonitoredDownload>();
  for (const { userId: requester, ...row } of rows) {
    let download = grouped.get(row.id);
    if (!download) { download = { ...row, userIds: [] }; grouped.set(row.id, download); }
    if (requester) download.userIds.push(requester);
  }
  let completed = 0;
  return [...grouped.values()].filter((row) => row.completedAt == null || ++completed <= 100);
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

export async function getLatestMonitoredDownloadBySourceMedia(
  source: 'radarr' | 'sonarr',
  mediaId: number
): Promise<MonitoredDownload | undefined> {
  return db.query.monitoredDownloads.findFirst({
    where: and(
      eq(monitoredDownloads.source, source),
      eq(monitoredDownloads.mediaId, mediaId)
    ),
    orderBy: desc(monitoredDownloads.createdAt),
  });
}

export async function updateDownloadStatus(id: number, status: string): Promise<void> {
  await db
    .update(monitoredDownloads)
    .set({ lastStatus: status })
    .where(and(eq(monitoredDownloads.id, id), isNull(monitoredDownloads.completedAt)));
}

export async function markDownloadCompleted(id: number): Promise<void> {
  await db
    .update(monitoredDownloads)
    .set({ completedAt: Date.now() })
    .where(eq(monitoredDownloads.id, id));
}

export async function updateDownloadActivity(
  id: number,
  hasBytesActivity: boolean
): Promise<void> {
  const now = Date.now();
  await db
    .update(monitoredDownloads)
    .set({
      lastActivityAt: now,
      ...(hasBytesActivity ? { lastBytesAt: now } : {}),
    })
    .where(eq(monitoredDownloads.id, id));
}

export async function resetMonitoredDownload(id: number): Promise<void> {
  await db
    .update(monitoredDownloads)
    .set({ lastStatus: null, completedAt: null, lastActivityAt: Date.now(), lastBytesAt: Date.now() })
    .where(eq(monitoredDownloads.id, id));
}
