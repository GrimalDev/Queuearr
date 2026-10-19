import type { MovieAudioJob, MovieAudioPolicy } from '@/lib/db/movie-audio';
import { getAvailableAudio, getPublicMovieAudioDetail } from '@/lib/movie-audio-policy';
import { TransmissionStatus, type QueueItem, type RadarrMovie, type TransmissionTorrent } from '@/types';

export function getMovieAudioQueue(
  jobs: MovieAudioJob[], policies: Map<number, MovieAudioPolicy>, movies: RadarrMovie[],
  visibleMovieIds?: Set<number>,
  settledIds: Set<number> = new Set(),
): QueueItem[] {
  const library = new Map(movies.map((movie) => [movie.id, movie]));
  return jobs.flatMap((job): QueueItem[] => {
    const policy = policies.get(job.tmdbId);
    if (!policy || job.state === 'cancelled' || (job.state === 'available' && !settledIds.has(job.tmdbId)) ||
        (visibleMovieIds && !visibleMovieIds.has(policy.radarrMovieId))) return [];
    const movie = library.get(policy.radarrMovieId);
    if (!movie || movie.tmdbId !== job.tmdbId) return [];
    if (job.state === 'available') return [{
      id: `movie-${job.tmdbId}`, tmdbId: job.tmdbId, mediaId: policy.radarrMovieId, source: 'radarr', title: movie.title,
      subtitle: movie.year?.toString(), status: 'completed', progress: 100, size: 0, sizeRemaining: 0, hasError: false, isStalled: false,
    }];
    const isRegrab = job.state === 'regrabbing' || job.regrabFileId != null;
    const additionalAudio = movie.hasFile && !isRegrab;
    const available = getAvailableAudio(movie);
    const missing = policy.requiredLanguages.filter((language) => !available.some((item) => item.id === language.id));
    const languages = job.donorLanguageId
      ? policy.requiredLanguages.filter((language) => language.id === job.donorLanguageId) : missing;
    const hasError = job.state === 'in_cinemas' || getPublicMovieAudioDetail(job.state, job.detail) === 'Error';
    const phase = hasError ? 'error' : job.state === 'validating' || job.state === 'merging' || job.state === 'verifying'
      ? job.state : job.state === 'downloading' ? 'downloading' : 'searching';
    return [{
      id: `${additionalAudio ? 'audio' : 'movie'}-${job.tmdbId}`, tmdbId: job.tmdbId,
      source: 'radarr', mediaId: policy.radarrMovieId, isRegrab,
      isSearching: (job.replaceDonor || !additionalAudio) && !hasError && job.state !== 'grab_pending',
      isAwaitingDownload: job.state === 'grab_pending',
      searchError: job.state === 'in_cinemas' ? 'in_cinemas' : undefined,
      canRetrySearch: !job.donorHash && !job.outputPath && job.restoreMonitored == null && !job.replaceDonor &&
        ['pending', 'downloading', 'regrabbing', 'waiting_for_configuration', 'search_failed', 'in_cinemas'].includes(job.state),
      title: movie.title, subtitle: movie.year?.toString(), transmissionHash: job.donorHash ?? undefined,
      audio: additionalAudio ? { phase, languages,
        canRetry: !!job.donorHash && !job.outputPath && job.restoreMonitored == null && !job.replaceDonor &&
          ['pending', 'downloading', 'waiting_for_configuration'].includes(job.state) } : undefined,
      indexer: job.donorIndexer ?? undefined,
      status: hasError ? 'failed' : !additionalAudio || phase === 'searching' ? 'pending' : phase === 'downloading' ? 'downloading' : 'importing',
      progress: 0, size: 0, sizeRemaining: 0, isStalled: false, hasError,
      errorMessage: hasError ? 'Error' : undefined,
    }];
  });
}

/** Replace ordinary movie/torrent rows with a single audio job, including during metadata retrieval. */
export function mergeMovieAudioQueue(
  items: QueueItem[], audioItems: QueueItem[], torrents: Map<string, TransmissionTorrent>,
): QueueItem[] {
  const audioMovieIds = new Set(audioItems.map((item) => item.mediaId));
  const merged = audioItems.map((item): QueueItem => {
    const hash = item.transmissionHash?.toLowerCase();
    const movieDownload = items.find((entry) => entry.source === 'radarr' && !entry.audio && entry.mediaId === item.mediaId &&
      (!hash || entry.transmissionHash?.toLowerCase() === hash));
    const torrent = hash ? torrents.get(hash) : undefined;
    if (hash) torrents.delete(hash);
    if (!item.audio) return movieDownload ? {
      ...movieDownload, id: item.id, tmdbId: item.tmdbId, isRegrab: item.isRegrab, isSearching: false,
      indexer: movieDownload.indexer ?? item.indexer,
    } : item;
    if (item.isSearching) return item;
    const phase = item.audio!.phase;
    const metadataProgress = torrent?.metadataPercentComplete ?? movieDownload?.metadataPercentComplete;
    const metadata = metadataProgress != null && metadataProgress < 1;
    const transferring = phase === 'downloading' || phase === 'searching';
    const hasError = item.hasError || !!torrent?.error || !!movieDownload?.hasError;
    const enriched = torrent ? {
      transmissionId: torrent.id, transmissionHash: torrent.hashString,
      addedDate: torrent.addedDate,
      startDate: torrent.startDate,
      progress: Math.min(100, Math.max(0, torrent.percentDone * 100)),
      size: torrent.sizeWhenDone, sizeRemaining: torrent.leftUntilDone,
      downloadSpeed: torrent.rateDownload, peersConnected: torrent.peersConnected,
      peersSendingToUs: torrent.peersSendingToUs,
      eta: torrent.eta > 0 ? `${Math.floor(torrent.eta / 3600).toString().padStart(2, '0')}:${Math.floor(torrent.eta % 3600 / 60).toString().padStart(2, '0')}:${Math.floor(torrent.eta % 60).toString().padStart(2, '0')}` : undefined,
    } : movieDownload ? {
      transmissionId: movieDownload.transmissionId, transmissionHash: movieDownload.transmissionHash,
      addedDate: movieDownload.addedDate,
      startDate: movieDownload.startDate,
      progress: movieDownload.progress, size: movieDownload.size, sizeRemaining: movieDownload.sizeRemaining,
      downloadSpeed: movieDownload.downloadSpeed, eta: movieDownload.eta,
      peersConnected: movieDownload.peersConnected, peersSendingToUs: movieDownload.peersSendingToUs,
    } : {};
    return {
      ...item, ...enriched, indexer: item.indexer ?? movieDownload?.indexer,
      hasError, errorMessage: hasError ? 'Error' : undefined,
      audio: { ...item.audio!, canRetry: item.audio!.canRetry && (torrent?.percentDone ?? movieDownload?.progress ?? 0) < (torrent ? 1 : 100),
        phase: hasError ? 'error' : transferring && metadata ? 'metadata' :
        transferring && (torrent || movieDownload) ? 'downloading' : phase },
      status: hasError ? 'failed' : !transferring ? item.status : torrent?.status === TransmissionStatus.STOPPED ? 'paused'
        : torrent?.status === TransmissionStatus.DOWNLOAD_WAIT ? 'queued' : metadata ? 'pending' : movieDownload?.status ?? item.status,
    };
  });
  return [...items.filter((item) => item.source !== 'radarr' || !audioMovieIds.has(item.mediaId)), ...merged];
}
