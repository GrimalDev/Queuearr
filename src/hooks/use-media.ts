import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useAppStore, QueueServiceError, SearchSortKey, SearchSortDir } from '@/store/app-store';
import { SearchResult, QueueItem, RadarrMovie, SonarrSeries, RadarrQueueItem, SonarrQueueItem, TransmissionTorrent, TransmissionStatus } from '@/types';
import { mergeMovieAudioQueue } from '@/lib/movie-audio-queue';
import { matchesQueueRequest, mergePendingQueueRequests } from '@/lib/queue-requests';

const STALL_GRACE_PERIOD_SECONDS = 5 * 60;

function sortResults(results: SearchResult[], key: SearchSortKey, dir: SearchSortDir): void {
  const multiplier = dir === 'asc' ? 1 : -1;

  results.sort((a, b) => {
    switch (key) {
      case 'rating':
        return multiplier * ((a.rating ?? -1) - (b.rating ?? -1));

      case 'year':
        return multiplier * (a.year - b.year);

      case 'recent': {
        const aTime = a.releaseDate ? Date.parse(a.releaseDate) : NaN;
        const bTime = b.releaseDate ? Date.parse(b.releaseDate) : NaN;
        const aValid = !isNaN(aTime);
        const bValid = !isNaN(bTime);
        if (!aValid && !bValid) return 0;
        if (!aValid) return multiplier;
        if (!bValid) return -multiplier;
        return multiplier * (aTime - bTime);
      }

      case 'popularity':
      default:
        return multiplier * ((a.popularity ?? 0) - (b.popularity ?? 0));
    }
  });
}

export function useSearch() {
  const {
    searchQuery,
    searchResults,
    isSearching,
    searchType,
    searchSortKey,
    searchSortDir,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
    setSearchType,
    setSearchSort,
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
            const movies: (RadarrMovie & Pick<SearchResult, 'availableAudioLanguages' | 'requestedAudioLanguages' | 'audioRequestState' | 'audioRequestDetail'> & { inLibrary: boolean; libraryId?: number; isDownloading?: boolean; monitoredId?: number; isWatching?: boolean })[] =
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
                rating: m.ratings?.tmdb?.value ?? m.ratings?.imdb?.value,
                isDownloading: m.isDownloading,
                monitoredId: m.monitoredId,
                isWatching: m.isWatching,
                hasFile: m.hasFile,
                originalLanguage: m.originalLanguage,
                availableAudioLanguages: m.availableAudioLanguages,
                requestedAudioLanguages: m.requestedAudioLanguages,
                audioRequestState: m.audioRequestState,
                audioRequestDetail: m.audioRequestDetail,
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
                rating: s.ratings?.value,
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

        sortResults(results, searchSortKey, searchSortDir);

        setSearchResults(results);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [searchType, searchSortKey, searchSortDir, setIsSearching, setSearchResults, addAlert]
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

  const previousSortRef = useRef({ key: searchSortKey, dir: searchSortDir });
  useEffect(() => {
    const prev = previousSortRef.current;
    if ((prev.key !== searchSortKey || prev.dir !== searchSortDir) && searchResults.length > 0) {
      const resorted = [...searchResults];
      sortResults(resorted, searchSortKey, searchSortDir);
      setSearchResults(resorted);
    }
    previousSortRef.current = { key: searchSortKey, dir: searchSortDir };
  }, [searchSortKey, searchSortDir, searchResults, setSearchResults]);

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
    searchSortKey,
    searchSortDir,
    setSearchType,
    setSearchSort,
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
  const pendingQueueRequests = useAppStore((state) => state.pendingQueueRequests);
  const isAdmin = session?.user?.role === 'admin';
  const isAdminRef = useRef(isAdmin);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);
  const hasFetchedRef = useRef(false);
  const currentFilterRef = useRef(filter);
  const currentUserRef = useRef(session?.user?.id);
  const currentRoleRef = useRef(session?.user?.role);
  const fetchSequenceRef = useRef(0);
  const inFlightRef = useRef<{ filter: 'mine' | 'all'; userId?: string; role?: string; sequence: number } | null>(null);
  const [queueScope, setQueueScope] = useState<{ filter: 'mine' | 'all'; userId?: string; role?: string } | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const previousProblematicRef = useRef<Set<string>>(new Set());

  // Track filter changes to handle stale responses
  useEffect(() => {
    if (currentFilterRef.current !== filter || currentUserRef.current !== session?.user?.id || currentRoleRef.current !== session?.user?.role) {
      currentFilterRef.current = filter;
      currentUserRef.current = session?.user?.id;
      currentRoleRef.current = session?.user?.role;
      fetchSequenceRef.current++;
      hasFetchedRef.current = false;
      previousProblematicRef.current = new Set();
      // Clear items immediately to avoid showing stale data during fetch
      setQueueItems([]);
      setIsLoadingQueue(true);
    }
  }, [filter, session?.user?.id, session?.user?.role, setIsLoadingQueue, setQueueItems]);

  const fetchQueue = useCallback(async (force = false) => {
    // Capture the filter at the start of this fetch
    const fetchFilter = filter;
    const fetchUserId = session?.user?.id;
    const fetchRole = session?.user?.role;
    if (!force && inFlightRef.current?.filter === fetchFilter && inFlightRef.current?.userId === fetchUserId && inFlightRef.current?.role === fetchRole) return;
    const fetchSequence = ++fetchSequenceRef.current;
    inFlightRef.current = { filter: fetchFilter, userId: fetchUserId, role: fetchRole, sequence: fetchSequence };
    const isCurrent = (): boolean => currentFilterRef.current === fetchFilter && currentUserRef.current === fetchUserId && currentRoleRef.current === fetchRole &&
      fetchSequenceRef.current === fetchSequence;
    
    if (!hasFetchedRef.current) {
      setIsLoadingQueue(true);
    }

    try {
      const errors: QueueServiceError[] = [];
      let items: QueueItem[] = [];
      let audioItems: QueueItem[] = [];
      const transmissionHashMap = new Map<string, TransmissionTorrent & {
        statusString: string;
        isProblematic: boolean;
        problemReason?: string;
      }>();
      const acceptedIds = useAppStore.getState().pendingQueueRequests
        .filter((request) => request.accepted && request.userId === session?.user?.id)
        .map((request) => request.item.tmdbId).filter((id) => id != null).slice(0, 20).join(',');

      const [radarrRes, sonarrRes, transmissionRes, monitoredRes, audioRes] = await Promise.allSettled([
        fetch(`/api/radarr/queue?filter=${fetchFilter}`),
        fetch(`/api/sonarr/queue?filter=${fetchFilter}`),
        fetch(`/api/transmission?filter=${fetchFilter}`),
        fetch(`/api/downloads/watch?filter=${fetchFilter}`),
        fetch(`/api/radarr/audio/queue?filter=${fetchFilter}&settled=${acceptedIds}`),
      ]);

      // Discard results if filter changed while we were fetching
      if (!isCurrent()) {
        return;
      }

      // Build source+mediaId → DB timestamps map
      type MonitoredRow = { source: 'radarr' | 'sonarr'; mediaId: number; title: string; lastStatus: string | null; createdAt: number; lastActivityAt: number | null; lastBytesAt: number | null; retryAvailableAt?: number; userIds: string[]; searchState?: string; searchIndexer?: string | null; retryRequiresReview?: boolean };
      const monitoredMap = new Map<string, MonitoredRow>();
      if (audioRes.status === 'fulfilled' && audioRes.value.ok) {
        audioItems = await audioRes.value.json() as QueueItem[];
      } else {
        errors.push({ service: 'audio', message: 'Error' });
      }
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
            const isStalledAfterGrace = matchedTorrent
              ? hasExceededStallGracePeriod(matchedTorrent)
              : false;
            
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
              metadataPercentComplete: matchedTorrent?.metadataPercentComplete,
              size: matchedTorrent?.sizeWhenDone || item.size,
              sizeRemaining: matchedTorrent?.leftUntilDone || item.sizeleft,
              downloadSpeed: matchedTorrent?.rateDownload,
              uploadSpeed: matchedTorrent?.rateUpload,
              eta: matchedTorrent?.eta && matchedTorrent.eta > 0 
                ? formatEta(matchedTorrent.eta) 
                : item.timeleft,
              isStalled: !!(matchedTorrent?.isStalled && isActivelyDownloading && isStalledAfterGrace),
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
              startDate: matchedTorrent?.startDate,
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
            const isStalledAfterGrace = matchedTorrent
              ? hasExceededStallGracePeriod(matchedTorrent)
              : false;

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
              isStalled: !!(matchedTorrent?.isStalled && isActivelyDownloading && isStalledAfterGrace),
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
              startDate: matchedTorrent?.startDate,
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
      items = mergeMovieAudioQueue(items, audioItems, transmissionHashMap);
      for (const monitored of monitoredMap.values()) {
        if ((monitored.lastStatus === null || monitored.searchState) && !['complete', 'cancelled'].includes(monitored.searchState ?? '') &&
            !items.some((item) => item.source === monitored.source && item.mediaId === monitored.mediaId)) {
          const hasError = ['search_failed', 'needs_review', 'needs_selection', 'in_cinemas'].includes(monitored.searchState ?? '');
          items.push({ id: `search-${monitored.source}-${monitored.mediaId}`, source: monitored.source,
            mediaId: monitored.mediaId, title: monitored.title, isSearching: !hasError && monitored.searchState !== 'grab_pending',
            isAwaitingDownload: monitored.searchState === 'grab_pending',
            searchError: monitored.searchState === 'in_cinemas' ? 'in_cinemas' : undefined,
            indexer: monitored.searchIndexer ?? undefined,
            status: hasError ? 'failed' : 'pending', canRetrySearch: !monitored.retryRequiresReview && monitored.searchState !== 'grab_pending',
            canCancelSearch: monitored.searchState !== 'grab_pending',
            progress: 0, size: 0, sizeRemaining: 0, hasError: !!hasError, isStalled: false });
        }
      }

      items = items.map((item) => {
        const monitored = item.mediaId != null ? monitoredMap.get(`${item.source}:${item.mediaId}`) : undefined;
        const own = isAdminRef.current || !!monitored?.userIds?.includes(session?.user?.id ?? '');
        return { ...item, retryAvailableAt: monitored?.retryAvailableAt ?? item.retryAvailableAt,
          dbCreatedAt: monitored?.createdAt ?? item.dbCreatedAt,
          canRetry: own, canRetrySearch: item.canRetrySearch && (own || !monitored),
          canCancelSearch: (item.canCancelSearch ?? item.canRetrySearch) && (own || !monitored) };
      });

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
            metadataPercentComplete: torrent.metadataPercentComplete,
            size: torrent.sizeWhenDone,
            sizeRemaining: torrent.leftUntilDone,
            downloadSpeed: torrent.rateDownload,
            uploadSpeed: torrent.rateUpload,
            eta: torrent.eta > 0 ? formatEta(torrent.eta) : undefined,
            isStalled: torrent.isStalled && torrent.status === TransmissionStatus.DOWNLOAD && hasExceededStallGracePeriod(torrent),
            hasError: torrent.isProblematic && torrent.status === TransmissionStatus.DOWNLOAD,
            errorMessage: torrent.problemReason,
            peersConnected: torrent.peersConnected,
            peersSendingToUs: torrent.peersSendingToUs,
            addedDate: torrent.addedDate,
            startDate: torrent.startDate,
            doneDate: torrent.doneDate,
            activityDate: torrent.activityDate,
          });
        }
      }

      // Parsing response bodies also awaits work. A filter or account can change during that time.
      if (!isCurrent()) return;
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
      const store = useAppStore.getState();
      for (const request of store.pendingQueueRequests) {
        if (request.accepted && items.some((item) => matchesQueueRequest(item, request.item))) store.finishQueueRequest(request.item.id);
      }
      setQueueScope({ filter: fetchFilter, userId: fetchUserId, role: fetchRole });
      setQueueItems(items);
      setQueueErrors(errors);
      setLastFetch(new Date());
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        setIsLoadingQueue(false);
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Queue fetch error:', error);
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        setIsLoadingQueue(false);
      }
    } finally {
      if (inFlightRef.current?.sequence === fetchSequence) inFlightRef.current = null;
    }
  }, [setIsLoadingQueue, setQueueItems, setQueueErrors, addAlert, filter, session?.user?.id, session?.user?.role]);

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
    queueItems: mergePendingQueueRequests(queueScope?.filter === filter && queueScope?.userId === session?.user?.id && queueScope?.role === session?.user?.role
      ? queueItems : [], pendingQueueRequests, session?.user?.id),
    isLoadingQueue,
    queueErrors,
    lastFetch,
    refresh: () => fetchQueue(true),
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

function hasExceededStallGracePeriod(torrent: TransmissionTorrent): boolean {
  const referenceDate = torrent.activityDate > 0 ? torrent.activityDate : torrent.addedDate;
  if (referenceDate <= 0) {
    return false;
  }

  return Date.now() / 1000 - referenceDate >= STALL_GRACE_PERIOD_SECONDS;
}
