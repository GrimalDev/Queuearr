import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/app-store';
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
            const movies: (RadarrMovie & { inLibrary: boolean; libraryId?: number })[] =
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
            const series: (SonarrSeries & { inLibrary: boolean; libraryId?: number })[] =
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

        results.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

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

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchType,
    setSearchType,
    search: debouncedSearch,
    clearSearch: () => {
      setSearchQuery('');
      setSearchResults([]);
    },
  };
}

export function useQueue(pollInterval = 5000) {
  const { queueItems, isLoadingQueue, setQueueItems, setIsLoadingQueue, addAlert } = useAppStore();
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const previousProblematicRef = useRef<Set<string>>(new Set());

  const fetchQueue = useCallback(async () => {
    setIsLoadingQueue(true);

    try {
      const items: QueueItem[] = [];

      const [radarrRes, sonarrRes, transmissionRes] = await Promise.allSettled([
        fetch('/api/radarr/queue'),
        fetch('/api/sonarr/queue'),
        fetch('/api/transmission'),
      ]);

      if (radarrRes.status === 'fulfilled' && radarrRes.value.ok) {
        const radarrQueue: RadarrQueueItem[] = await radarrRes.value.json();
        items.push(
          ...radarrQueue.map((item) => ({
            id: `radarr-${item.id}`,
            source: 'radarr' as const,
            title: item.movie?.title || item.title,
            subtitle: item.movie?.year?.toString(),
            status: mapRadarrStatus(item.status, item.trackedDownloadState),
            progress: item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0,
            size: item.size,
            sizeRemaining: item.sizeleft,
            eta: item.timeleft,
            isStalled: item.trackedDownloadState === 'importPending',
            hasError: !!item.errorMessage || (item.statusMessages?.length ?? 0) > 0,
            errorMessage: item.errorMessage || item.statusMessages?.[0]?.messages?.[0],
            downloadClient: item.downloadClient,
            indexer: item.indexer,
          }))
        );
      }

      if (sonarrRes.status === 'fulfilled' && sonarrRes.value.ok) {
        const sonarrQueue: SonarrQueueItem[] = await sonarrRes.value.json();
        items.push(
          ...sonarrQueue.map((item) => ({
            id: `sonarr-${item.id}`,
            source: 'sonarr' as const,
            title: item.series?.title || item.title,
            subtitle: item.episode
              ? `S${item.episode.seasonNumber.toString().padStart(2, '0')}E${item.episode.episodeNumber.toString().padStart(2, '0')} - ${item.episode.title}`
              : undefined,
            status: mapSonarrStatus(item.status, item.trackedDownloadState),
            progress: item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0,
            size: item.size,
            sizeRemaining: item.sizeleft,
            eta: item.timeleft,
            isStalled: item.trackedDownloadState === 'importPending',
            hasError: !!item.errorMessage || (item.statusMessages?.length ?? 0) > 0,
            errorMessage: item.errorMessage || item.statusMessages?.[0]?.messages?.[0],
            downloadClient: item.downloadClient,
            indexer: item.indexer,
          }))
        );
      }

      if (transmissionRes.status === 'fulfilled' && transmissionRes.value.ok) {
        const data: {
          torrents: (TransmissionTorrent & {
            statusString: string;
            isProblematic: boolean;
            problemReason?: string;
          })[];
        } = await transmissionRes.value.json();
        items.push(
          ...data.torrents.map((torrent) => ({
            id: `transmission-${torrent.id}`,
            source: 'transmission' as const,
            title: torrent.name,
            status: mapTransmissionStatus(torrent.status, torrent.isFinished),
            progress: torrent.percentDone * 100,
            size: torrent.sizeWhenDone,
            sizeRemaining: torrent.leftUntilDone,
            downloadSpeed: torrent.rateDownload,
            uploadSpeed: torrent.rateUpload,
            eta: torrent.eta > 0 ? formatEta(torrent.eta) : undefined,
            isStalled: torrent.isStalled,
            hasError: torrent.error > 0 || torrent.isProblematic,
            errorMessage: torrent.errorString || torrent.problemReason,
          }))
        );
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
      setLastFetch(new Date());
    } catch (error) {
      console.error('Queue fetch error:', error);
    } finally {
      setIsLoadingQueue(false);
    }
  }, [setIsLoadingQueue, setQueueItems, addAlert]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, pollInterval);
    return () => clearInterval(interval);
  }, [fetchQueue, pollInterval]);

  return {
    queueItems,
    isLoadingQueue,
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

  switch (status.toLowerCase()) {
    case 'downloading':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'queued':
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

  switch (status.toLowerCase()) {
    case 'downloading':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'queued':
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
