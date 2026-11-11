import axios from 'axios';
import { createHttpsAgentForService } from '@/lib/api/tls';
import { normalizeTorrentHash } from '@/lib/db/torrent-indexers';
import type { QueueItem, SonarrEpisode, SonarrSeries } from '@/types';

interface ImportRecord {
  downloadId?: string;
  seriesId?: number;
  episodeId?: number;
  eventType?: string;
}

const cache = new Map<string, { nextCheckAt: number; expiresAt: number; item?: QueueItem }>();
let inFlight: Promise<void> | undefined;

export function getImportedSonarrTorrents(hashes: string[]): QueueItem[] {
  return hashes.flatMap((hash) => {
    const match = cache.get(hash.toLowerCase());
    return match && match.expiresAt > Date.now() && match.item ? [match.item] : [];
  });
}

/** Reconcile retained torrents without blocking polling or submitting new searches. */
export function recoverImportedSonarrTorrents(hashes: string[]): Promise<void> {
  if (inFlight) return inFlight;
  const task = async (): Promise<void> => {
    const baseURL = process.env.SONARR_URL;
    const apiKey = process.env.SONARR_API_KEY;
    if (!baseURL || !apiKey) return;
    const current = new Set(hashes.map(normalizeTorrentHash).filter((hash) => hash !== undefined));
    for (const hash of cache.keys()) if (!current.has(hash)) cache.delete(hash);
    const pending = [...current].filter((hash) => (cache.get(hash)?.nextCheckAt ?? 0) <= Date.now())
      .sort((a, b) => (cache.get(a)?.nextCheckAt ?? 0) - (cache.get(b)?.nextCheckAt ?? 0)).slice(0, 8);
    if (!pending.length) return;
    const client = axios.create({ baseURL, headers: { 'X-Api-Key': apiKey }, timeout: 10_000,
      httpsAgent: createHttpsAgentForService('sonarr') });
    const shows = new Map<number, Promise<{ series: SonarrSeries; episodes: SonarrEpisode[] }>>();
    const loadShow = (seriesId: number): Promise<{ series: SonarrSeries; episodes: SonarrEpisode[] }> => {
      let show = shows.get(seriesId);
      if (!show) {
        show = Promise.all([
          client.get<SonarrSeries>(`/api/v3/series/${seriesId}`),
          client.get<SonarrEpisode[]>('/api/v3/episode', { params: { seriesId } }),
        ]).then(([series, episodes]) => ({ series: series.data, episodes: episodes.data }));
        shows.set(seriesId, show);
      }
      return show;
    };
    const recover = async (): Promise<void> => {
      while (pending.length) {
        const hash = pending.shift();
        if (!hash) break;
        try {
          const { data } = await client.get<{ totalRecords: number; records: ImportRecord[] }>('/api/v3/history', {
            params: { downloadId: hash.toUpperCase(), page: 1, pageSize: 1000, sortKey: 'date', sortDirection: 'descending' },
          });
          const imports = data.records.filter((record) => normalizeTorrentHash(record.downloadId) === hash &&
            record.eventType === 'downloadFolderImported');
          const seriesId = imports[0]?.seriesId;
          const episodeIds = [...new Set(imports.map((record) => record.episodeId))];
          let item: QueueItem | undefined;
          if (data.totalRecords <= data.records.length && seriesId && Number.isSafeInteger(seriesId) && seriesId > 0 &&
              imports.every((record) => record.seriesId === seriesId) && episodeIds.length &&
              episodeIds.every((id) => id !== undefined && Number.isSafeInteger(id) && id > 0)) {
            const { series, episodes } = await loadShow(seriesId);
            const selected = episodes.filter((episode) => episodeIds.includes(episode.id));
            if (series.id === seriesId && selected.length === episodeIds.length && selected.every((episode) => episode.hasFile)) {
              const subtitle = selected.length === 1
                ? `S${String(selected[0].seasonNumber).padStart(2, '0')}E${String(selected[0].episodeNumber).padStart(2, '0')} - ${selected[0].title}`
                : `${selected.length} episodes imported`;
              item = { id: `sonarr-${hash}`, source: 'sonarr', mediaId: seriesId, title: series.title, subtitle,
                episodeIds: selected.map((episode) => episode.id),
                episodeId: selected.length === 1 ? selected[0].id : undefined,
                seasonNumber: selected.every((episode) => episode.seasonNumber === selected[0].seasonNumber) ? selected[0].seasonNumber : undefined,
                transmissionHash: hash, status: 'completed', libraryReady: true, progress: 100,
                size: 0, sizeRemaining: 0, hasError: false, isStalled: false,
                canRetry: false, canRetrySearch: false, canCancelSearch: false, canCancelDownload: false };
            }
          }
          cache.set(hash, { item, nextCheckAt: Date.now() + (item ? 4 : 10) * 60_000,
            expiresAt: Date.now() + (item ? 5 : 10) * 60_000 });
        } catch {
          // Do not reuse an expired readiness result after a failed verification.
          cache.set(hash, { nextCheckAt: Date.now() + 60_000, expiresAt: Date.now() + 60_000 });
          console.warn('[imports] Sonarr import verification failed; retained torrent remains unconfirmed.');
        }
      }
    };
    await Promise.all([recover(), recover()]);
  };
  inFlight = task().finally(() => { inFlight = undefined; });
  return inFlight;
}
