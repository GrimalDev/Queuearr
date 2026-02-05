'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Plus, Check, Film, Tv, Calendar, Loader2, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch } from '@/hooks/use-media';
import { useAppStore } from '@/store/app-store';
import { SearchResult } from '@/types';

export function SearchResults() {
  const { searchResults, isSearching, searchQuery } = useSearch();
  const { addAlert } = useAppStore();
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  const formatSortScore = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const handleAdd = async (result: SearchResult) => {
    setAddingIds((prev) => new Set(prev).add(result.id));

    try {
      const endpoint = result.type === 'movie' ? '/api/radarr/search' : '/api/sonarr/search';
      const body =
        result.type === 'movie'
          ? { title: result.title, tmdbId: result.tmdbId, year: result.year }
          : { title: result.title, tvdbId: result.tvdbId };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        addAlert({
          type: 'success',
          title: 'Added Successfully',
          message: `${result.title} has been added to ${result.type === 'movie' ? 'Radarr' : 'Sonarr'}`,
          source: result.type === 'movie' ? 'radarr' : 'sonarr',
        });
      } else {
        throw new Error('Failed to add');
      }
    } catch (error) {
      console.error('Add error:', error);
      addAlert({
        type: 'error',
        title: 'Failed to Add',
        message: `Could not add ${result.title}. Please try again.`,
        source: result.type === 'movie' ? 'radarr' : 'sonarr',
      });
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {searchResults.map((result) => (
        <Card key={result.id} className="overflow-hidden group">
          <div className="relative aspect-[2/3] bg-muted">
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
            {result.inLibrary && (
              <div className="absolute top-2 left-2">
                <Badge variant="outline" className="bg-green-500/90 text-white border-0">
                  <Check className="h-3 w-3 mr-1" />
                  In Library
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
            {result.overview && (
              <p className="text-sm text-muted-foreground line-clamp-3">{result.overview}</p>
            )}
            <Button
              className="w-full"
              variant={result.inLibrary ? 'secondary' : 'default'}
              disabled={result.inLibrary || addingIds.has(result.id)}
              onClick={() => handleAdd(result)}
            >
              {addingIds.has(result.id) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : result.inLibrary ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Already Added
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add to {result.type === 'movie' ? 'Radarr' : 'Sonarr'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
