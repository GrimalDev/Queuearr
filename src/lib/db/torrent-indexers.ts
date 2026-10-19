import { db } from '@/lib/db';
import { torrentIndexers } from '@/lib/db/schema';
import { inArray, ne, or } from 'drizzle-orm';

export function normalizeTorrentHash(value?: string): string | undefined {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : undefined;
}

export function getTorrentIndexers(hashes: string[]): Map<string, string> {
  const requested = [...new Set(hashes.map(normalizeTorrentHash).filter((hash) => hash !== undefined))];
  const result = new Map<string, string>();
  for (let offset = 0; offset < requested.length; offset += 500) {
    for (const row of db.select().from(torrentIndexers).where(inArray(torrentIndexers.hash, requested.slice(offset, offset + 500))).all()) {
      result.set(row.hash, row.indexer);
    }
  }
  return result;
}

export function rememberTorrentIndexer(source: 'radarr' | 'sonarr', downloadId: string | undefined, indexer: string | undefined): void {
  const hash = normalizeTorrentHash(downloadId);
  if (!hash || typeof indexer !== 'string' || !indexer.trim()) return;
  const values = { hash, source, indexer: indexer.trim(), updatedAt: Date.now() };
  db.insert(torrentIndexers).values(values).onConflictDoUpdate({ target: torrentIndexers.hash, set: values,
    setWhere: or(ne(torrentIndexers.indexer, values.indexer), ne(torrentIndexers.source, source)) }).run();
}
