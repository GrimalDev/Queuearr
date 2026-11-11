import type { QueueItem, TransmissionTorrent } from '@/types';

/** Active queues and audio jobs consume their hashes first and retain control. */
export function mergeImportedSonarrTorrents(
  items: QueueItem[], torrents: Map<string, TransmissionTorrent>, imports: QueueItem[],
): QueueItem[] {
  const result = [...items];
  for (const item of imports) {
    const hash = item.transmissionHash?.toLowerCase();
    const torrent = hash ? torrents.get(hash) : undefined;
    if (!hash || !torrent || torrent.percentDone < 1 || item.source !== 'sonarr' || item.libraryReady !== true) continue;
    torrents.delete(hash);
    if (result.some((existing) => existing.transmissionHash?.toLowerCase() === hash)) continue;
    result.push({ ...item, transmissionId: torrent.id, transmissionHash: torrent.hashString,
      size: torrent.sizeWhenDone, sizeRemaining: 0, downloadSpeed: torrent.rateDownload, uploadSpeed: torrent.rateUpload,
      indexer: torrent.indexer, estimatedAudioLanguages: torrent.estimatedAudioLanguages,
      peersConnected: torrent.peersConnected, addedDate: torrent.addedDate, startDate: torrent.startDate,
      doneDate: torrent.doneDate, activityDate: torrent.activityDate });
  }
  return result;
}
