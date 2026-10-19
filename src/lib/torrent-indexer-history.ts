import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { getTorrentIndexerMetadata, normalizeTorrentHash, rememberTorrentIndexer } from '@/lib/db/torrent-indexers';

const nextCheck = new Map<string, number>();
let inFlight: Promise<void> | undefined;

/** Bounded background lookups. Download polling never waits for history services. */
export function recoverTorrentIndexers(hashes: string[]): Promise<void> {
  if (inFlight) return inFlight;
  const task = async (): Promise<void> => {
    const current = new Set(hashes.map(normalizeTorrentHash).filter((hash) => hash !== undefined));
    for (const hash of nextCheck.keys()) if (!current.has(hash)) nextCheck.delete(hash);
    const known = getTorrentIndexerMetadata([...current]);
    const pending = [...current].filter((hash) => (!known.has(hash) || known.get(hash)?.audioLanguages == null) && (nextCheck.get(hash) ?? 0) <= Date.now()).slice(0, 8);
    if (!pending.length) return;
    const services = [
      { source: 'radarr' as const, client: createRadarrClient() },
      { source: 'sonarr' as const, client: createSonarrClient() },
    ].filter((service) => service.client !== null);
    const failed = new Set<string>();
    const recover = async (): Promise<void> => {
      while (pending.length) {
        const hash = pending.shift();
        if (!hash) break;
        const results = await Promise.allSettled(services.map(async ({ source, client }) => {
          const records = await client!.getGrabHistory(hash);
          const match = records.find((record) => normalizeTorrentHash(record.downloadId) === hash &&
            record.eventType === 'grabbed' && typeof record.data?.indexer === 'string' && record.data.indexer.trim());
          return match?.data?.indexer ? { source, indexer: match.data.indexer, languages: match.languages ?? (match.language ? [match.language] : []) } : undefined;
        }));
        let found = false;
        let error = false;
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === 'rejected') { error = true; failed.add(services[i].source); }
          else if (!found && result.value) {
            rememberTorrentIndexer(result.value.source, hash, result.value.indexer, result.value.languages);
            found = true;
          }
        }
        if (found) nextCheck.delete(hash);
        else nextCheck.set(hash, Date.now() + (error ? 2 : 10) * 60_000);
      }
    };
    await Promise.all([recover(), recover()]);
    for (const source of failed) console.warn(`[indexers] ${source} history lookup failed; download polling remains available.`);
  };
  inFlight = task().finally(() => { inFlight = undefined; });
  return inFlight;
}
