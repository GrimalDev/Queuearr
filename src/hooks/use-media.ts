import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useAppStore, QueueServiceError } from '@/store/app-store';
import { SearchResult, QueueItem, RadarrMovie, SonarrSeries, RadarrQueueItem, SonarrQueueItem, TransmissionTorrent, TransmissionStatus } from '@/types';

export function useSearch() {
  const {
    searchQuery,
    searchResults,
    isSearching,
    searchType,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
    setSearchType,
    addAlert,
  } = useAppStore();

  const searchTimeoutRef = useRef<NodeJS.Timeout>(undefined);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);

      try {
        const results: SearchResult[] = [];

        if (searchType === 'all' || searchType === 'movies') {
          const response = await fetch(`/api/radarr/search?q=${encodeURIComponent(query)}`);
          if (response.ok) {
            const movies: (RadarrMovie & { inLibrary: boolean; libraryId?: number; isDownloading?: boolean; monitoredId?: number; isWatching?: boolean })[] =
              await response.json();
            results.push(
              ...movies.map((m) => ({
                id: `movie-${m.tmdbId}`,
                type: 'movie' as const,
                title: m.title,
                year: m.year,
                overview: m.overview,
                posterUrl: m.images?.find((i) => i.coverType === 'poster')?.remoteUrl,
                tmdbId: m.tmdbId,
                imdbId: m.imdbId,
                status: m.status,
                inLibrary: m.inLibrary,
                libraryId: m.libraryId,
                popularity: m.popularity ?? m.ratings?.tmdb?.votes ?? 0,
                popularitySource: m.popularity !== undefined ? 'Radarr' : 'TMDB votes',
                isDownloading: m.isDownloading,
                monitoredId: m.monitoredId,
                isWatching: m.isWatching,
                hasFile: m.hasFile,
                releaseDate: m.inCinemas ?? m.physicalRelease ?? m.digitalRelease ?? m.added,
              }))
            );
          } else if (response.status === 504) {
            addAlert({
              type: 'warning',
              title: 'Movie Search Timeout',
              message: 'Radarr search timed out. Try a more specific search term.',
              source: 'radarr',
            });
          }
        }

        if (searchType === 'all' || searchType === 'series') {
          const response = await fetch(`/api/sonarr/search?q=${encodeURIComponent(query)}`);
          if (response.ok) {
            const series: (SonarrSeries & { inLibrary: boolean; libraryId?: number; isDownloading?: boolean; monitoredId?: number; isWatching?: boolean })[] =
              await response.json();
            results.push(
              ...series.map((s) => ({
                id: `series-${s.tvdbId}`,
                type: 'series' as const,
                title: s.title,
                year: s.year,
                overview: s.overview,
                posterUrl: s.images?.find((i) => i.coverType === 'poster')?.remoteUrl,
                tvdbId: s.tvdbId,
                imdbId: s.imdbId,
                status: s.status,
                inLibrary: s.inLibrary,
                libraryId: s.libraryId,
                popularity: s.ratings?.votes ?? 0,
                popularitySource: 'Sonarr votes',
                isDownloading: s.isDownloading,
                monitoredId: s.monitoredId,
                isWatching: s.isWatching,
                seasons: s.seasons?.filter((sn) => sn.seasonNumber > 0),
                releaseDate: s.firstAired ?? s.added,
              }))
            );
          } else if (response.status === 504) {
            addAlert({
              type: 'warning',
              title: 'Series Search Timeout',
              message: 'Sonarr search timed out. Try a more specific search term.',
              source: 'sonarr',
            });
          }
        }

        results.sort((a, b) => {
          const aTime = a.releaseDate ? Date.parse(a.releaseDate) : NaN;
          const bTime = b.releaseDate ? Date.parse(b.releaseDate) : NaN;
          const aValid = !isNaN(aTime);
          const bValid = !isNaN(bTime);
          if (aValid || bValid) {
            return (bValid ? bTime : 0) - (aValid ? aTime : 0);
          }
          return (b.popularity ?? 0) - (a.popularity ?? 0);
        });

        setSearchResults(results);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [searchType, setIsSearching, setSearchResults, addAlert]
  );

  const debouncedSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(() => {
        search(query);
      }, 300);
    },
    [search, setSearchQuery]
  );

  const previousSearchTypeRef = useRef(searchType);
  useEffect(() => {
    if (previousSearchTypeRef.current !== searchType && searchQuery.trim()) {
      search(searchQuery);
    }
    previousSearchTypeRef.current = searchType;
  }, [searchType, searchQuery, search]);

  const immediateSearch = useCallback(
    (query: string) => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      setSearchQuery(query);
      search(query);
    },
    [search, setSearchQuery]
  );

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchType,
    setSearchType,
    search: debouncedSearch,
    immediateSearch,
    clearSearch: () => {
      setSearchQuery('');
      setSearchResults([]);
    },
  };
}

export function useQueue(filter: 'mine' | 'all' = 'mine') {
  const { queueItems, isLoadingQueue, queueErrors, setQueueItems, setIsLoadingQueue, setQueueErrors, addAlert } = useAppStore();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const isAdminRef = useRef(isAdmin);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);
  const hasFetchedRef = useRef(false);
  const currentFilterRef = useRef(filter);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const previousProblematicRef = useRef<Set<string>>(new Set());

  // Track filter changes to handle stale responses
  useEffect(() => {
    if (currentFilterRef.current !== filter) {
      currentFilterRef.current = filter;
      hasFetchedRef.current = false;
      previousProblematicRef.current = new Set();
      // Clear items immediately to avoid showing stale data during fetch
      setQueueItems([]);
      setIsLoadingQueue(true);
    }
  }, [filter, setIsLoadingQueue, setQueueItems]);

  const fetchQueue = useCallback(async () => {
    // Capture the filter at the start of this fetch
    const fetchFilter = filter;
    
    if (!hasFetchedRef.current) {
      setIsLoadingQueue(true);
    }

    try {
      const errors: QueueServiceError[] = [];
      const items: QueueItem[] = [];
      const transmissionHashMap = new Map<string, TransmissionTorrent & {
        statusString: string;
        isProblematic: boolean;
        problemReason?: string;
      }>();

      const [radarrRes, sonarrRes, transmissionRes, monitoredRes] = await Promise.allSettled([
        fetch(`/api/radarr/queue?filter=${fetchFilter}`),
        fetch(`/api/sonarr/queue?filter=${fetchFilter}`),
        fetch(`/api/transmission?filter=${fetchFilter}`),
        fetch(`/api/downloads/watch?filter=${fetchFilter}`),
      ]);

      // Discard results if filter changed while we were fetching
      if (currentFilterRef.current !== fetchFilter) {
        return;
      }

      // Build source+mediaId → DB timestamps map
      type MonitoredRow = { source: string; mediaId: number; createdAt: number; lastActivityAt: number | null; lastBytesAt: number | null };
      const monitoredMap = new Map<string, MonitoredRow>();
      if (monitoredRes.status === 'fulfilled' && monitoredRes.value.ok) {
        const rows: MonitoredRow[] = await monitoredRes.value.json();
        for (const row of rows) {
          monitoredMap.set(`${row.source}:${row.mediaId}`, row);
        }
      }

      if (transmissionRes.status === 'fulfilled' && transmissionRes.value.ok) {
        const data: {
          torrents: (TransmissionTorrent & {
            statusString: string;
            isProblematic: boolean;
            problemReason?: string;
          })[];
          stats: {
            downloadQueueEnabled: boolean;
            downloadQueueSize: number;
            activeTorrentCount: number;
          };
        } = await transmissionRes.value.json();

        for (const torrent of data.torrents) {
          transmissionHashMap.set(torrent.hashString.toLowerCase(), torrent);
        }
      } else if (transmissionRes.status === 'fulfilled' && !transmissionRes.value.ok) {
        const errText = await transmissionRes.value.text().catch(() => 'Connection failed');
        errors.push({ service: 'transmission', message: errText });
      } else if (transmissionRes.status === 'rejected') {
        errors.push({ service: 'transmission', message: transmissionRes.reason?.message || 'Connection failed' });
      }
      if (radarrRes.status === 'fulfilled' && radarrRes.value.ok) {
        const radarrQueue: RadarrQueueItem[] = await radarrRes.value.json();
        items.push(
          ...radarrQueue.map((item) => {
            const downloadHash = item.downloadId?.toLowerCase();
            const matchedTorrent = downloadHash ? transmissionHashMap.get(downloadHash) : undefined;
            
            if (matchedTorrent) {
              transmissionHashMap.delete(downloadHash!);
            }

            const transmissionStatus = matchedTorrent
              ? mapTransmissionStatus(matchedTorrent.status, matchedTorrent.isFinished)
              : undefined;
            const radarrStatus = mapRadarrStatus(item.status, item.trackedDownloadState);
            const effectiveStatus = transmissionStatus ?? radarrStatus;

            const isQueuedInTransmission = matchedTorrent?.status === TransmissionStatus.DOWNLOAD_WAIT;
            const isActivelyDownloading = matchedTorrent?.status === TransmissionStatus.DOWNLOAD;
            
            const hasRealError = (!!item.errorMessage || (item.statusMessages?.length ?? 0) > 0) &&
              !isQueuedInTransmission;
            const transmissionHasError = matchedTorrent?.isProblematic && isActivelyDownloading;

            return {
              id: `radarr-${item.id}`,
              sourceId: item.id,
              mediaId: item.movieId,
              source: 'radarr' as const,
              transmissionId: matchedTorrent?.id,
              transmissionHash: matchedTorrent?.hashString,
              title: item.movie?.title || item.title,
              subtitle: item.movie?.year?.toString(),
              status: effectiveStatus,
              progress: matchedTorrent
                ? matchedTorrent.percentDone * 100
                : item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0,
              size: matchedTorrent?.sizeWhenDone || item.size,
              sizeRemaining: matchedTorrent?.leftUntilDone || item.sizeleft,
              downloadSpeed: matchedTorrent?.rateDownload,
              uploadSpeed: matchedTorrent?.rateUpload,
              eta: matchedTorrent?.eta && matchedTorrent.eta > 0 
                ? formatEta(matchedTorrent.eta) 
                : item.timeleft,
              isStalled: !!(matchedTorrent?.isStalled && isActivelyDownloading),
              hasError: !!(hasRealError || transmissionHasError),
              errorMessage: hasRealError
                ? (item.errorMessage || item.statusMessages?.[0]?.messages?.[0])
                : matchedTorrent?.problemReason,
              downloadClient: item.downloadClient,
              indexer: item.indexer,
              quality: item.quality?.quality?.name,
              estimatedCompletionTime: item.estimatedCompletionTime,
              peersConnected: matchedTorrent?.peersConnected,
              peersSendingToUs: matchedTorrent?.peersSendingToUs,
              addedDate: matchedTorrent?.addedDate,
              doneDate: matchedTorrent?.doneDate,
              activityDate: matchedTorrent?.activityDate,
              ...(() => { const m = item.movieId ? monitoredMap.get(`radarr:${item.movieId}`) : undefined; return m ? { dbCreatedAt: m.createdAt, dbLastActivityAt: m.lastActivityAt, dbLastBytesAt: m.lastBytesAt } : {}; })(),
            };
          })
        );
      } else if (radarrRes.status === 'fulfilled' && !radarrRes.value.ok) {
        const errText = await radarrRes.value.text().catch(() => 'Connection failed');
        errors.push({ service: 'radarr', message: errText });
      } else if (radarrRes.status === 'rejected') {
        errors.push({ service: 'radarr', message: radarrRes.reason?.message || 'Connection failed' });
      }
      if (sonarrRes.status === 'fulfilled' && sonarrRes.value.ok) {
        const sonarrQueue: SonarrQueueItem[] = await sonarrRes.value.json();

        // Group items by downloadId — season packs create one entry per episode
        // but all share the same torrent hash. We only want one card per download.
        const byDownloadId = new Map<string, SonarrQueueItem[]>();
        const noHash: SonarrQueueItem[] = [];
        for (const item of sonarrQueue) {
          const hash = item.downloadId?.toLowerCase();
          if (hash) {
            const group = byDownloadId.get(hash) ?? [];
            group.push(item);
            byDownloadId.set(hash, group);
          } else {
            noHash.push(item);
          }
        }

        // One representative per group (first item), plus items with no hash
        const representatives = [
          ...Array.from(byDownloadId.values()).map((group) => group[0]),
          ...noHash,
        ];
        items.push(
          ...representatives.map((item) => {
            const downloadHash = item.downloadId?.toLowerCase();
            const matchedTorrent = downloadHash ? transmissionHashMap.get(downloadHash) : undefined;

            if (matchedTorrent) {
              transmissionHashMap.delete(downloadHash!);
            }

            const transmissionStatus = matchedTorrent
              ? mapTransmissionStatus(matchedTorrent.status, matchedTorrent.isFinished)
              : undefined;
            const sonarrStatus = mapSonarrStatus(item.status, item.trackedDownloadState);
            const effectiveStatus = transmissionStatus ?? sonarrStatus;

            const isQueuedInTransmission = matchedTorrent?.status === TransmissionStatus.DOWNLOAD_WAIT;
            const isActivelyDownloading = matchedTorrent?.status === TransmissionStatus.DOWNLOAD;

            const hasRealError = (!!item.errorMessage || (item.statusMessages?.length ?? 0) > 0) &&
              !isQueuedInTransmission;
            const transmissionHasError = matchedTorrent?.isProblematic && isActivelyDownloading;

            const groupSize = downloadHash ? (byDownloadId.get(downloadHash)?.length ?? 1) : 1;
            const isPack = groupSize > 1;
            let subtitle: string | undefined;
            if (isPack) {
              const season = item.episode?.seasonNumber;
              subtitle = season !== undefined
                ? `Season ${season} Pack (${groupSize} episodes)`
                : `Pack (${groupSize} episodes)`;
            } else {
              subtitle = item.episode
                ? `S${item.episode.seasonNumber.toString().padStart(2, '0')}E${item.episode.episodeNumber.toString().padStart(2, '0')} - ${item.episode.title}`
                : undefined;
            }

            return {
              id: `sonarr-${item.id}`,
              sourceId: item.id,
              mediaId: item.seriesId,
              episodeId: item.episodeId,
              source: 'sonarr' as const,
              transmissionId: matchedTorrent?.id,
              transmissionHash: matchedTorrent?.hashString,
              title: item.series?.title || item.title,
              subtitle,
              status: effectiveStatus,
              progress: matchedTorrent
                ? matchedTorrent.percentDone * 100
                : item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0,
              size: matchedTorrent?.sizeWhenDone || item.size,
              sizeRemaining: matchedTorrent?.leftUntilDone || item.sizeleft,
              downloadSpeed: matchedTorrent?.rateDownload,
              uploadSpeed: matchedTorrent?.rateUpload,
              eta: matchedTorrent?.eta && matchedTorrent.eta > 0
                ? formatEta(matchedTorrent.eta)
                : item.timeleft,
              isStalled: !!(matchedTorrent?.isStalled && isActivelyDownloading),
              hasError: !!(hasRealError || transmissionHasError),
              errorMessage: hasRealError
                ? (item.errorMessage || item.statusMessages?.[0]?.messages?.[0])
                : matchedTorrent?.problemReason,
              downloadClient: item.downloadClient,
              indexer: item.indexer,
              quality: item.quality?.quality?.name,
              estimatedCompletionTime: item.estimatedCompletionTime,
              peersConnected: matchedTorrent?.peersConnected,
              peersSendingToUs: matchedTorrent?.peersSendingToUs,
              addedDate: matchedTorrent?.addedDate,
              doneDate: matchedTorrent?.doneDate,
              activityDate: matchedTorrent?.activityDate,
              ...(() => { const m = item.seriesId ? monitoredMap.get(`sonarr:${item.seriesId}`) : undefined; return m ? { dbCreatedAt: m.createdAt, dbLastActivityAt: m.lastActivityAt, dbLastBytesAt: m.lastBytesAt } : {}; })(),
            };
          })
        );
      } else if (sonarrRes.status === 'fulfilled' && !sonarrRes.value.ok) {
        const errText = await sonarrRes.value.text().catch(() => 'Connection failed');
        errors.push({ service: 'sonarr', message: errText });
      } else if (sonarrRes.status === 'rejected') {
        errors.push({ service: 'sonarr', message: sonarrRes.reason?.message || 'Connection failed' });
      }
      // Only add unmatched Transmission torrents for admins when viewing all downloads
      if (isAdminRef.current && fetchFilter === 'all') {
        const unmatchedCount = transmissionHashMap.size;
        console.log(`[useQueue] Adding ${unmatchedCount} unmatched transmission torrents (admin, filter=all)`);
        for (const torrent of transmissionHashMap.values()) {
          items.push({
            id: `transmission-${torrent.id}`,
            source: 'transmission' as const,
            transmissionId: torrent.id,
            transmissionHash: torrent.hashString,
            title: torrent.name,
            status: mapTransmissionStatus(torrent.status, torrent.isFinished),
            progress: torrent.percentDone * 100,
            size: torrent.sizeWhenDone,
            sizeRemaining: torrent.leftUntilDone,
            downloadSpeed: torrent.rateDownload,
            uploadSpeed: torrent.rateUpload,
            eta: torrent.eta > 0 ? formatEta(torrent.eta) : undefined,
            isStalled: torrent.isStalled && torrent.status === TransmissionStatus.DOWNLOAD,
            hasError: torrent.isProblematic && torrent.status === TransmissionStatus.DOWNLOAD,
            errorMessage: torrent.problemReason,
            peersConnected: torrent.peersConnected,
            peersSendingToUs: torrent.peersSendingToUs,
            addedDate: torrent.addedDate,
            doneDate: torrent.doneDate,
            activityDate: torrent.activityDate,
          });
        }
      }

      const currentProblematic = new Set(
        items.filter((item) => item.hasError || item.isStalled).map((item) => item.id)
      );

      currentProblematic.forEach((id) => {
        if (!previousProblematicRef.current.has(id)) {
          const item = items.find((i) => i.id === id);
          if (item) {
            addAlert({
              type: item.hasError ? 'error' : 'warning',
              title: item.isStalled ? 'Download Stalled' : 'Download Issue',
              message: `${item.title}: ${item.errorMessage || 'Unknown issue'}`,
              source: item.source,
              relatedItemId: item.id,
            });
          }
        }
      });

      previousProblematicRef.current = currentProblematic;
      setQueueItems(items);
      setQueueErrors(errors);
      setLastFetch(new Date());
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        setIsLoadingQueue(false);
      }
    } catch (error) {
      console.error('Queue fetch error:', error);
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        setIsLoadingQueue(false);
      }
    }
  }, [setIsLoadingQueue, setQueueItems, setQueueErrors, addAlert, filter]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void fetchQueue();
    }, 0);
    const id = setInterval(fetchQueue, 5_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [fetchQueue]);

  return {
    queueItems,
    isLoadingQueue,
    queueErrors,
    lastFetch,
    refresh: fetchQueue,
  };
}

function mapRadarrStatus(
  status: string,
  trackedDownloadState?: string
): QueueItem['status'] {
  if (trackedDownloadState === 'importPending') return 'importing';
  if (trackedDownloadState === 'failedPending') return 'failed';
  if (trackedDownloadState === 'importBlocked') return 'warning';

  switch (status.toLowerCase()) {
    case 'downloading':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'queued':
    case 'delay':
      return 'queued';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'warning':
      return 'warning';
    default:
      return 'pending';
  }
}

function mapSonarrStatus(
  status: string,
  trackedDownloadState?: string
): QueueItem['status'] {
  if (trackedDownloadState === 'importPending') return 'importing';
  if (trackedDownloadState === 'failedPending') return 'failed';
  if (trackedDownloadState === 'importBlocked') return 'warning';

  switch (status.toLowerCase()) {
    case 'downloading':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'queued':
    case 'delay':
      return 'queued';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'warning':
      return 'warning';
    default:
      return 'pending';
  }
}

function mapTransmissionStatus(
  status: TransmissionStatus,
  isFinished: boolean
): QueueItem['status'] {
  if (isFinished) return 'completed';

  switch (status) {
    case TransmissionStatus.STOPPED:
      return 'paused';
    case TransmissionStatus.CHECK_WAIT:
    case TransmissionStatus.CHECK:
      return 'pending';
    case TransmissionStatus.DOWNLOAD_WAIT:
      return 'queued';
    case TransmissionStatus.DOWNLOAD:
      return 'downloading';
    case TransmissionStatus.SEED_WAIT:
    case TransmissionStatus.SEED:
      return 'seeding';
    default:
      return 'pending';
  }
}

function formatEta(seconds: number): string {
  if (seconds < 0) return 'Unknown';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
