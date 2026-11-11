import { TransmissionStatus, type MonitoredQueueDownload, type QueueItem, type TransmissionTorrent } from '@/types';

/** Keep the request card after transfer/import, without inferring readiness from seeding. */
export function mergeDownloadLifecycle(
  items: QueueItem[], downloads: MonitoredQueueDownload[], torrents: Map<string, TransmissionTorrent>,
): QueueItem[] {
  let result = [...items];
  for (const download of downloads) {
    if (download.lastStatus === 'cancelled') continue;
    const state = download.audioState ?? download.searchState;
    const searchWaitingReason = state === 'waiting_for_airdate' ? 'airdate' : state === 'waiting_for_release' ? 'release' : undefined;
    const searchStates = ['pending', 'searching', 'search_failed', 'needs_selection', 'waiting_for_airdate', 'waiting_for_release'];
    const scopes = download.searchScopes ?? [];
    const matchesSelection = (item: QueueItem): boolean => download.source !== 'sonarr' || !scopes.length || scopes.some((scope) =>
      scope.type === 'series' || scope.type === 'season' && item.seasonNumber === scope.seasonNumber ||
      scope.type === 'episode' && (item.episodeIds ?? (item.episodeId ? [item.episodeId] : [])).includes(scope.episodeId));
    let matching = result.filter((item) => item.source === download.source && item.mediaId === download.mediaId);
    if (download.source === 'radarr' && matching.length > 1) {
      const primary = matching.find((item) => !['completed', 'seeding'].includes(item.status)) ?? matching[0];
      result = result.filter((item) => !matching.includes(item) || item === primary);
      matching = [primary];
    }
    matching = matching.filter(matchesSelection);
    const remainingEpisodeIds = download.remainingEpisodeIds ?? scopes.flatMap((scope) => scope.type === 'episode' ? [scope.episodeId] : []);
    const missingEpisodes = remainingEpisodeIds.filter((id) => !matching.some((item) =>
      (item.episodeIds ?? (item.episodeId ? [item.episodeId] : [])).includes(id)));
    const transfer = download.source === 'sonarr' && searchStates.includes(state ?? '') ? undefined
      : [...(download.downloadHashes ?? [])].reverse().map((hash) => torrents.get(hash.toLowerCase())).find((item) => item !== undefined);
    // Old primary torrents may keep seeding while an isolated audio donor is processed.
    for (const hash of download.downloadHashes ?? []) torrents.delete(hash.toLowerCase());
    if (!matching.length || missingEpisodes.length && searchStates.includes(state ?? '')) {
      const hasError = ['search_failed', 'needs_review', 'needs_selection', 'in_cinemas', 'waiting_for_configuration', 'cancelling'].includes(state ?? '');
      const transferring = !hasError && transfer && transfer.percentDone < 1 && ['downloading', 'regrabbing', 'grab_pending'].includes(state ?? '');
      const importing = !transferring && !hasError && (state === 'downloading' || state === 'regrabbing' || download.lastStatus === 'importing');
      const ready = download.libraryReady === true;
      result.push({ id: `request-${download.source}-${download.mediaId}`, source: download.source, mediaId: download.mediaId,
        episodeIds: missingEpisodes.length ? missingEpisodes : undefined,
        subtitle: missingEpisodes.length ? `${missingEpisodes.length} episode${missingEpisodes.length === 1 ? '' : 's'} ${download.remainingEpisodeIds ? 'remaining' : 'requested'}` : undefined,
        title: download.title, libraryReady: ready, requestedAudioLanguages: download.requestedAudioLanguages,
        estimatedAudioLanguages: download.estimatedAudioLanguages?.length ? download.estimatedAudioLanguages : transfer?.estimatedAudioLanguages,
        isSearching: !ready && !hasError && !searchWaitingReason && !transferring && !importing && state !== 'grab_pending' && !['validating', 'merging', 'replacing', 'verifying'].includes(state ?? ''),
        searchWaitingReason, nextAirAt: download.nextAirAt ?? undefined,
        isAwaitingDownload: !transferring && state === 'grab_pending', searchError: state === 'in_cinemas' ? 'in_cinemas' : undefined,
        lifecyclePhase: state === 'validating' ? 'checking_audio' : state === 'merging' || state === 'replacing' || state === 'verifying' ? state : undefined,
        indexer: download.searchIndexer ?? transfer?.indexer,
        status: ready ? 'completed' : hasError ? 'failed' : transferring
          ? transfer.status === TransmissionStatus.STOPPED ? 'paused' : transfer.status === TransmissionStatus.DOWNLOAD_WAIT ? 'queued' : 'downloading' : importing ? 'importing' : 'pending',
        canRetrySearch: !ready && !importing && !download.retryRequiresReview &&
          [...searchStates, 'in_cinemas'].includes(state ?? 'pending'),
        canCancelSearch: !ready && !transferring && !importing && state !== 'grab_pending' && !download.audioState,
        canCancelDownload: state === 'cancelling' || !!transferring,
        metadataPercentComplete: transfer?.metadataPercentComplete, downloadSpeed: transfer?.rateDownload,
        addedDate: transfer?.addedDate, startDate: transfer?.startDate, peersConnected: transfer?.peersConnected,
        progress: ready ? 100 : transfer ? transfer.percentDone * 100 : 0,
        size: transfer?.sizeWhenDone ?? 0, sizeRemaining: ready ? 0 : transfer?.leftUntilDone ?? 0,
        transmissionId: transfer?.id, transmissionHash: transfer?.hashString,
        hasError, errorMessage: hasError || searchWaitingReason ? download.errorMessage : undefined, isStalled: false });
    }
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      if (item.source !== download.source || item.mediaId !== download.mediaId) continue;
      const ready = download.libraryReady === true && item.libraryReady !== false && matchesSelection(item);
      result[i] = { ...item,
        restartReason: download.restartReason,
        id: item.source === 'radarr' ? `request-radarr-${download.mediaId}` : item.id,
        libraryReady: ready, requestedAudioLanguages: item.requestedAudioLanguages ?? download.requestedAudioLanguages,
        estimatedAudioLanguages: item.estimatedAudioLanguages?.length ? item.estimatedAudioLanguages : download.estimatedAudioLanguages,
        dbCreatedAt: download.createdAt, retryAvailableAt: download.retryAvailableAt ?? item.retryAvailableAt,
        indexer: item.indexer ?? download.searchIndexer ?? undefined,
        errorMessage: ready ? undefined : item.errorMessage ?? (item.hasError ? download.errorMessage : undefined),
        ...(ready ? { status: 'completed', progress: 100, sizeRemaining: 0, isSearching: false, isAwaitingDownload: false,
          lifecyclePhase: undefined, hasError: false, isStalled: false, audio: undefined,
          sourceId: undefined, canRetrySearch: false, canCancelSearch: false, canCancelDownload: false }
          : !item.audio && ['completed', 'seeding'].includes(item.status) ? { status: 'importing', isSearching: false } : {}),
      };
    }
  }
  return result;
}
