import { db } from '@/lib/db';
import { torrentIndexers } from '@/lib/db/schema';
import { inArray, ne, or } from 'drizzle-orm';
import { normalizeAudioLanguages } from '@/lib/audio-languages';

export function normalizeTorrentHash(value?: string): string | undefined {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : undefined;
}

export function getTorrentIndexers(hashes: string[]): Map<string, string> {
  return new Map([...getTorrentIndexerMetadata(hashes)].map(([hash, row]) => [hash, row.indexer]));
}

export function getTorrentIndexerMetadata(hashes: string[]): Map<string, typeof torrentIndexers.$inferSelect> {
  const requested = [...new Set(hashes.map(normalizeTorrentHash).filter((hash) => hash !== undefined))];
  const result = new Map<string, typeof torrentIndexers.$inferSelect>();
  for (let offset = 0; offset < requested.length; offset += 500) {
    for (const row of db.select().from(torrentIndexers).where(inArray(torrentIndexers.hash, requested.slice(offset, offset + 500))).all()) {
      result.set(row.hash, row);
    }
  }
  return result;
}

export function rememberTorrentIndexer(source: 'radarr' | 'sonarr', downloadId: string | undefined, indexer: string | undefined, languages?: unknown): void {
  const hash = normalizeTorrentHash(downloadId);
  if (!hash || typeof indexer !== 'string' || !indexer.trim()) return;
  const audioLanguages = languages === undefined ? undefined : JSON.stringify(normalizeAudioLanguages(languages));
  const values = { hash, source, indexer: indexer.trim(), updatedAt: Date.now(), ...(audioLanguages !== undefined ? { audioLanguages } : {}) };
  db.insert(torrentIndexers).values(values).onConflictDoUpdate({ target: torrentIndexers.hash, set: values,
    setWhere: audioLanguages !== undefined ? undefined : or(ne(torrentIndexers.indexer, values.indexer), ne(torrentIndexers.source, source)) }).run();
}
