'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, Film, Tv, Calendar, Star, Bell, BellOff, Download, List, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch } from '@/hooks/use-media';
import { useAppStore } from '@/store/app-store';
import { SearchResult } from '@/types';
import { SeriesBrowser } from '@/components/features/series-browser';
import { MovieAudioRequest } from '@/components/features/movie-audio-request';
import type { SearchSortKey } from '@/store/app-store';

const SORT_OPTIONS: { key: SearchSortKey; label: string }[] = [
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'recent', label: 'Recent' },
  { key: 'year', label: 'Year' },
];

export function SearchResults() {
  const { searchResults, isSearching, searchQuery, searchSortKey, searchSortDir, setSearchSort } = useSearch();
  const { addAlert } = useAppStore();
  const [watchingStates, setWatchingStates] = useState<Map<string, boolean>>(new Map());
  const [browsingSeries, setBrowsingSeries] = useState<SearchResult | null>(null);

  const handleSortClick = (key: SearchSortKey): void => {
    if (searchSortKey === key) {
      setSearchSort(key, searchSortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSearchSort(key, 'desc');
    }
  };

  const SortIcon = ({ k }: { k: SearchSortKey }) => {
    if (searchSortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return searchSortDir === 'desc'
      ? <ArrowDown className="h-3 w-3" />
      : <ArrowUp className="h-3 w-3" />;
  };

  const formatSortScore = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const handleToggleWatch = async (result: SearchResult) => {
    const source = result.type === 'movie' ? 'radarr' : 'sonarr';
    const mediaId = result.libraryId;
    if (!mediaId) return;

    const currentlyWatching =
      watchingStates.has(result.id) ? watchingStates.get(result.id)! : (result.isWatching ?? false);
    const method = currentlyWatching ? 'DELETE' : 'POST';

    try {
      const response = await fetch('/api/downloads/watch', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, mediaId }),
      });

      if (response.ok) {
        setWatchingStates((prev) => new Map(prev).set(result.id, !currentlyWatching));
        addAlert({
          type: 'success',
          title: currentlyWatching ? 'Unsubscribed' : 'Subscribed',
          message: currentlyWatching
            ? `You will no longer receive notifications for ${result.title}`
            : `You will be notified when ${result.title} finishes downloading`,
          source,
        });
      } else {
        throw new Error('Failed to toggle watch');
      }
    } catch (error) {
      console.error('Watch toggle error:', error);
      addAlert({
        type: 'error',
        title: 'Failed to update notifications',
        message: `Could not update notifications for ${result.title}.`,
        source,
      });
    }
  };

  if (isSearching) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <Skeleton className="h-[300px] w-full" />
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Film className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Search for media</h3>
        <p className="text-muted-foreground mt-1">
          Enter a movie or series title to get started
        </p>
      </div>
    );
  }

  if (searchResults.length === 0 && !isSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Film className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No results found</h3>
        <p className="text-muted-foreground mt-1">
          Try searching with different keywords
        </p>
      </div>
    );
  }

  return (
    <>
    <SeriesBrowser result={browsingSeries} onClose={() => setBrowsingSeries(null)} />
    <div className="flex flex-wrap items-center gap-1.5 pb-3">
      <span className="text-xs text-muted-foreground mr-1">Sort:</span>
      {SORT_OPTIONS.map(({ key, label }) => (
        <Button
          key={key}
          variant={searchSortKey === key ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => handleSortClick(key)}
        >
          {label}
          <SortIcon k={key} />
        </Button>
      ))}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {searchResults.map((result) => {
        const isWatching =
          watchingStates.has(result.id)
            ? watchingStates.get(result.id)!
            : (result.isWatching ?? false);

        return (
          <Card key={result.id} className="overflow-hidden group">
            <div className="relative aspect-[10/14] bg-muted">
              {result.posterUrl ? (
                <Image
                  src={result.posterUrl}
                  alt={result.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  {result.type === 'movie' ? (
                    <Film className="h-16 w-16 text-muted-foreground" />
                  ) : (
                    <Tv className="h-16 w-16 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="absolute top-2 right-2">
                <Badge variant={result.type === 'movie' ? 'default' : 'secondary'}>
                  {result.type === 'movie' ? 'Movie' : 'Series'}
                </Badge>
              </div>
              {result.inLibrary && !result.isDownloading && (
                <div className="absolute top-2 left-2">
                  <Badge variant="outline" className="bg-green-500/90 text-white border-0">
                    <Check className="h-3 w-3 mr-1" />
                    In Library
                  </Badge>
                </div>
              )}
              {result.isDownloading && (
                <div className="absolute top-2 left-2">
                  <Badge variant="outline" className="bg-blue-500/90 text-white border-0">
                    <Download className="h-3 w-3 mr-1" />
                    Downloading
                  </Badge>
                </div>
              )}
            </div>
            <CardContent className="p-4 space-y-3">
              <div>
                <h3 className="font-semibold line-clamp-1">{result.title}</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <Calendar className="h-3 w-3" />
                  {result.year}
                  {result.status && (
                    <>
                      <span>•</span>
                      <span className="capitalize">{result.status}</span>
                    </>
                  )}
                  {result.popularity !== undefined && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {formatSortScore(result.popularity)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {result.type === 'series' ? (
                /* ── Series: season-first flow ── */
                <div className="space-y-2">
                  {result.isDownloading ? (
                    <div className="flex gap-2">
                      <Button className="flex-1" variant="secondary" disabled>
                        <Download className="h-4 w-4 mr-2" />
                        Downloading
                      </Button>
                      <Button
                        variant={isWatching ? 'default' : 'outline'}
                        size="icon"
                        onClick={() => handleToggleWatch(result)}
                        title={isWatching ? 'Unsubscribe from notifications' : 'Get notified when done'}
                      >
                        {isWatching ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      variant={result.inLibrary ? 'secondary' : 'default'}
                      onClick={() => setBrowsingSeries(result)}
                    >
                      {result.inLibrary ? (
                        <><List className="h-4 w-4 mr-2" />Choose Season(s)</>
                      ) : (
                        <><List className="h-4 w-4 mr-2" />Pick Season(s) to Download</>
                      )}
                    </Button>
                  )}
                  <p className="px-1 text-xs text-muted-foreground">
                    Download only the needed season(s) instead of grabbing the whole series.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <MovieAudioRequest key={result.id} result={result} />
                  {result.libraryId && (result.isDownloading || (result.audioRequestState && result.audioRequestState !== 'available')) && (
                    <Button className="w-full" variant="outline" onClick={() => handleToggleWatch(result)}>
                      {isWatching ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}
                      {isWatching ? 'Stop notifications' : 'Notify me when ready'}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
    </>
  );
}
