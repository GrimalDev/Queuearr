import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { downloadTransfers, monitoredDownloads } from '@/lib/db/schema';
import { normalizeTorrentHash } from '@/lib/db/torrent-indexers';

export function rememberDownloadTransfer(source: 'radarr' | 'sonarr', mediaId?: number, downloadId?: string): void {
  const hash = normalizeTorrentHash(downloadId);
  if (!hash || !mediaId) return;
  const request = db.select({ id: monitoredDownloads.id }).from(monitoredDownloads)
    .where(and(eq(monitoredDownloads.source, source), eq(monitoredDownloads.mediaId, mediaId))).get();
  if (request) db.insert(downloadTransfers).values({ downloadId: request.id, hash }).onConflictDoNothing().run();
}

export function getDownloadTransferHashes(ids: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    for (const row of db.select().from(downloadTransfers).where(inArray(downloadTransfers.downloadId, ids.slice(offset, offset + 500))).all()) {
      result.set(row.downloadId, [...(result.get(row.downloadId) ?? []), row.hash]);
    }
  }
  return result;
}
