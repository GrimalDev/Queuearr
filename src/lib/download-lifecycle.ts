import { TransmissionStatus, type MonitoredQueueDownload, type QueueItem, type TransmissionTorrent } from '@/types';

/** Keep the request card after transfer/import, without inferring readiness from seeding. */
export function mergeDownloadLifecycle(
  items: QueueItem[], downloads: MonitoredQueueDownload[], torrents: Map<string, TransmissionTorrent>,
): QueueItem[] {
  let result = [...items];
  for (const download of downloads) {
    if (download.lastStatus === 'cancelled') continue;
    let matching = result.filter((item) => item.source === download.source && item.mediaId === download.mediaId);
    if (download.source === 'radarr' && matching.length > 1) {
      const primary = matching.find((item) => !['completed', 'seeding'].includes(item.status)) ?? matching[0];
      result = result.filter((item) => !matching.includes(item) || item === primary);
      matching = [primary];
    }
    const transfer = [...(download.downloadHashes ?? [])].reverse().map((hash) => torrents.get(hash.toLowerCase())).find((item) => item !== undefined);
    // Old primary torrents may keep seeding while an isolated audio donor is processed.
    for (const hash of download.downloadHashes ?? []) torrents.delete(hash.toLowerCase());
    if (!matching.length) {
      const state = download.audioState ?? download.searchState;
      const hasError = ['search_failed', 'needs_review', 'needs_selection', 'in_cinemas', 'waiting_for_configuration', 'cancelling'].includes(state ?? '');
      const transferring = !hasError && transfer && transfer.percentDone < 1 && ['downloading', 'regrabbing', 'grab_pending'].includes(state ?? '');
      const importing = !transferring && !hasError && (state === 'downloading' || state === 'regrabbing' || download.lastStatus === 'importing');
      const ready = download.libraryReady === true;
      result.push({ id: `request-${download.source}-${download.mediaId}`, source: download.source, mediaId: download.mediaId,
        title: download.title, libraryReady: ready, requestedAudioLanguages: download.requestedAudioLanguages,
        estimatedAudioLanguages: download.estimatedAudioLanguages?.length ? download.estimatedAudioLanguages : transfer?.estimatedAudioLanguages,
        isSearching: !ready && !hasError && !transferring && !importing && state !== 'grab_pending' && !['validating', 'merging', 'replacing', 'verifying'].includes(state ?? ''),
        isAwaitingDownload: !transferring && state === 'grab_pending', searchError: state === 'in_cinemas' ? 'in_cinemas' : undefined,
        lifecyclePhase: state === 'validating' ? 'checking_audio' : state === 'merging' || state === 'replacing' || state === 'verifying' ? state : undefined,
        indexer: download.searchIndexer ?? transfer?.indexer,
        status: ready ? 'completed' : hasError ? 'failed' : transferring
          ? transfer.status === TransmissionStatus.STOPPED ? 'paused' : transfer.status === TransmissionStatus.DOWNLOAD_WAIT ? 'queued' : 'downloading' : importing ? 'importing' : 'pending',
        canRetrySearch: !ready && !importing && !download.retryRequiresReview &&
          ['pending', 'searching', 'search_failed', 'in_cinemas', 'needs_selection'].includes(state ?? 'pending'),
        canCancelSearch: !ready && !transferring && !importing && state !== 'grab_pending' && !download.audioState,
        canCancelDownload: state === 'cancelling' || !!transferring,
        metadataPercentComplete: transfer?.metadataPercentComplete, downloadSpeed: transfer?.rateDownload,
        addedDate: transfer?.addedDate, startDate: transfer?.startDate, peersConnected: transfer?.peersConnected,
        progress: ready ? 100 : transfer ? transfer.percentDone * 100 : 0,
        size: transfer?.sizeWhenDone ?? 0, sizeRemaining: ready ? 0 : transfer?.leftUntilDone ?? 0,
        transmissionId: transfer?.id, transmissionHash: transfer?.hashString,
        hasError, isStalled: false });
    }
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      if (item.source !== download.source || item.mediaId !== download.mediaId) continue;
      const ready = download.libraryReady === true && item.libraryReady !== false;
      result[i] = { ...item,
        id: item.source === 'radarr' ? `request-radarr-${download.mediaId}` : item.id,
        libraryReady: ready, requestedAudioLanguages: item.requestedAudioLanguages ?? download.requestedAudioLanguages,
        estimatedAudioLanguages: item.estimatedAudioLanguages?.length ? item.estimatedAudioLanguages : download.estimatedAudioLanguages,
        dbCreatedAt: download.createdAt, retryAvailableAt: download.retryAvailableAt ?? item.retryAvailableAt,
        indexer: item.indexer ?? download.searchIndexer ?? undefined,
        ...(ready ? { status: 'completed', progress: 100, sizeRemaining: 0, isSearching: false, isAwaitingDownload: false,
          lifecyclePhase: undefined, hasError: false, isStalled: false, audio: undefined,
          sourceId: undefined, canRetrySearch: false, canCancelSearch: false, canCancelDownload: false }
          : !item.audio && ['completed', 'seeding'].includes(item.status) ? { status: 'importing', isSearching: false } : {}),
      };
    }
  }
  return result;
}
