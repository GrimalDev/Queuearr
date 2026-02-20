'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Check,
  Download,
  Loader2,
  ChevronDown,
  ChevronRight,
  Calendar,
  Tv,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SearchResult, SonarrEpisode } from '@/types';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

interface SeriesBrowserProps {
  result: SearchResult | null;
  onClose: () => void;
}

interface SeasonData {
  expanded: boolean;
  episodes: SonarrEpisode[];
}

export function SeriesBrowser({ result, onClose }: SeriesBrowserProps) {
  const { addAlert } = useAppStore();

  // libraryId may change if we add the series during this session
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [seasonData, setSeasonData] = useState<Map<number, SeasonData>>(new Map());
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [addingToLibrary, setAddingToLibrary] = useState(false);
  const [grabbingSeasons, setGrabbingSeasons] = useState<Set<number>>(new Set());
  const [grabbingEpisodes, setGrabbingEpisodes] = useState<Set<number>>(new Set());

  // Reset state whenever the selected series changes
  useEffect(() => {
    if (!result) return;
    setLibraryId(result.libraryId ?? null);
    setSeasonData(new Map());
    setLoadingEpisodes(false);
    setAddingToLibrary(false);
    setGrabbingSeasons(new Set());
    setGrabbingEpisodes(new Set());
  }, [result?.id]);

  const fetchEpisodes = useCallback(async (sid: number) => {
    setLoadingEpisodes(true);
    try {
      const res = await fetch(`/api/sonarr/series/${sid}/episodes`);
      if (!res.ok) throw new Error('Failed to fetch episodes');
      const eps: SonarrEpisode[] = await res.json();

      // Group by season (skip specials)
      const bySeason = new Map<number, SonarrEpisode[]>();
      for (const ep of eps) {
        if (ep.seasonNumber === 0) continue;
        if (!bySeason.has(ep.seasonNumber)) bySeason.set(ep.seasonNumber, []);
        bySeason.get(ep.seasonNumber)!.push(ep);
      }
      for (const [, list] of bySeason) {
        list.sort((a, b) => a.episodeNumber - b.episodeNumber);
      }

      const seasonNums = Array.from(bySeason.keys()).sort((a, b) => a - b);
      const newData = new Map<number, SeasonData>();
      for (const sn of seasonNums) {
        newData.set(sn, { expanded: false, episodes: bySeason.get(sn)! });
      }
      setSeasonData(newData);
    } catch {
      addAlert({ type: 'error', title: 'Failed to load episodes', message: 'Could not load episode list.', source: 'sonarr' });
    } finally {
      setLoadingEpisodes(false);
    }
  }, [addAlert]);

  // Auto-fetch episodes when series is in library
  useEffect(() => {
    if (result?.inLibrary && result.libraryId) {
      fetchEpisodes(result.libraryId);
    }
  }, [result?.id, result?.inLibrary, result?.libraryId, fetchEpisodes]);

  // Also fetch when libraryId is set during this session (after add)
  useEffect(() => {
    if (libraryId && !(result?.inLibrary && result?.libraryId)) {
      fetchEpisodes(libraryId);
    }
  }, [libraryId]);

  const toggleSeason = (seasonNumber: number) => {
    setSeasonData((prev) => {
      const next = new Map(prev);
      const s = next.get(seasonNumber);
      if (s) next.set(seasonNumber, { ...s, expanded: !s.expanded });
      return next;
    });
  };

  /** Ensure series is in library; returns the library ID or null on failure. */
  const ensureInLibrary = async (): Promise<number | null> => {
    if (libraryId) return libraryId;
    if (!result) return null;

    setAddingToLibrary(true);
    try {
      const res = await fetch('/api/sonarr/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: result.title,
          tvdbId: result.tvdbId,
          searchForMissingEpisodes: false,
        }),
      });
      if (!res.ok) throw new Error('Failed to add series');
      const series = await res.json();
      setLibraryId(series.id);
      return series.id as number;
    } catch {
      addAlert({ type: 'error', title: 'Failed to add series', message: 'Could not add series to Sonarr.', source: 'sonarr' });
      return null;
    } finally {
      setAddingToLibrary(false);
    }
  };

  const handleGrabSeason = async (seasonNumber: number) => {
    setGrabbingSeasons((prev) => new Set(prev).add(seasonNumber));
    try {
      const sid = await ensureInLibrary();
      if (!sid) return;

      const res = await fetch(`/api/sonarr/series/${sid}/grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'season', seasonNumber }),
      });
      if (!res.ok) throw new Error('Failed to grab');
      addAlert({
        type: 'success',
        title: 'Season queued',
        message: `Searching for Season ${seasonNumber} of ${result?.title}…`,
        source: 'sonarr',
      });
    } catch {
      addAlert({ type: 'error', title: 'Grab failed', message: `Could not grab Season ${seasonNumber}.`, source: 'sonarr' });
    } finally {
      setGrabbingSeasons((prev) => { const n = new Set(prev); n.delete(seasonNumber); return n; });
    }
  };

  const handleGrabEpisode = async (ep: SonarrEpisode) => {
    setGrabbingEpisodes((prev) => new Set(prev).add(ep.id));
    try {
      // Episode IDs are only valid for library series — ensureInLibrary should have
      // already been called before this, but guard anyway.
      const sid = libraryId;
      if (!sid) return;

      const res = await fetch(`/api/sonarr/series/${sid}/grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'episode', episodeId: ep.id }),
      });
      if (!res.ok) throw new Error('Failed to grab');
      const code = `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
      addAlert({
        type: 'success',
        title: 'Episode queued',
        message: `Searching for ${code} – ${ep.title}…`,
        source: 'sonarr',
      });
    } catch {
      addAlert({ type: 'error', title: 'Grab failed', message: 'Could not grab episode.', source: 'sonarr' });
    } finally {
      setGrabbingEpisodes((prev) => { const n = new Set(prev); n.delete(ep.id); return n; });
    }
  };

  if (!result) return null;

  const isInLibrary = !!(result.inLibrary || libraryId);
  const episodesLoaded = seasonData.size > 0;

  // Seasons list: use loaded episodes data if available, otherwise fall back to
  // the season metadata from the search result.
  const seasons: number[] = episodesLoaded
    ? Array.from(seasonData.keys()).sort((a, b) => a - b)
    : (result.seasons ?? []).map((s) => s.seasonNumber).sort((a, b) => a - b);

  return (
    <Sheet open={!!result} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start gap-4">
            {result.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.posterUrl}
                alt={result.title}
                className="w-14 h-20 object-cover rounded-md shrink-0 shadow"
              />
            ) : (
              <div className="w-14 h-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Tv className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-bold leading-tight line-clamp-2">
                {result.title}
              </SheetTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {result.year}
                </span>
                {result.status && (
                  <>
                    <span>·</span>
                    <span className="capitalize">{result.status}</span>
                  </>
                )}
              </div>
              <div className="mt-2">
                {isInLibrary ? (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    In Library
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-xs">
                    Not in library
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* Body */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {(loadingEpisodes || addingToLibrary) ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">
                  {addingToLibrary ? 'Adding to library…' : 'Loading episodes…'}
                </span>
              </div>
            ) : seasons.length === 0 ? (
              <p className="text-center py-12 text-sm text-muted-foreground">No seasons found.</p>
            ) : (
              seasons.map((seasonNumber) => {
                const data = seasonData.get(seasonNumber);
                const episodes = data?.episodes ?? [];
                const isExpanded = data?.expanded ?? false;
                const isGrabbingSeason = grabbingSeasons.has(seasonNumber);

                // Stats from loaded episodes or from search result metadata
                let downloaded = 0;
                let total = 0;
                if (data) {
                  downloaded = episodes.filter((e) => e.hasFile).length;
                  total = episodes.length;
                } else {
                  const meta = result.seasons?.find((s) => s.seasonNumber === seasonNumber);
                  downloaded = meta?.statistics?.episodeFileCount ?? 0;
                  total = meta?.statistics?.episodeCount ?? meta?.statistics?.totalEpisodeCount ?? 0;
                }

                const allDownloaded = total > 0 && downloaded === total;

                return (
                  <div key={seasonNumber} className="rounded-lg border overflow-hidden">
                    {/* Season row */}
                    <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                      {/* Expand toggle — only when episodes are loaded */}
                      <button
                        className={cn(
                          'flex items-center gap-2 flex-1 min-w-0 text-left',
                          episodesLoaded ? 'cursor-pointer' : 'cursor-default'
                        )}
                        onClick={() => episodesLoaded && toggleSeason(seasonNumber)}
                        disabled={!episodesLoaded}
                      >
                        {episodesLoaded && (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium text-sm">Season {seasonNumber}</span>
                        {total > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {isInLibrary
                              ? `${downloaded} / ${total} downloaded`
                              : `${total} episode${total !== 1 ? 's' : ''}`}
                          </span>
                        )}
                        {allDownloaded && (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 text-xs py-0">
                            <Check className="h-3 w-3 mr-1" />
                            Complete
                          </Badge>
                        )}
                      </button>

                      {!allDownloaded && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs shrink-0"
                          disabled={isGrabbingSeason || addingToLibrary}
                          onClick={() => handleGrabSeason(seasonNumber)}
                        >
                          {isGrabbingSeason ? (
                            <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Searching…</>
                          ) : (
                            <><Download className="h-3 w-3 mr-1" />Grab Season</>
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Episode list */}
                    {isExpanded && episodes.length > 0 && (
                      <>
                        <Separator />
                        <div className="divide-y">
                          {episodes.map((ep) => {
                            const code = `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
                            const isGrabbingEp = grabbingEpisodes.has(ep.id);
                            return (
                              <div
                                key={ep.id}
                                className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 text-sm"
                              >
                                <span className="font-mono text-xs text-muted-foreground w-14 shrink-0">
                                  {code}
                                </span>
                                <span className="flex-1 truncate">{ep.title}</span>
                                {ep.airDate && (
                                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                                    {ep.airDate}
                                  </span>
                                )}
                                {ep.hasFile ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-green-500/10 text-green-600 border-green-500/30 shrink-0 px-1.5 py-0"
                                  >
                                    <Check className="h-3 w-3" />
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0 shrink-0"
                                    disabled={isGrabbingEp}
                                    title={`Grab ${code}`}
                                    onClick={() => handleGrabEpisode(ep)}
                                  >
                                    {isGrabbingEp
                                      ? <Loader2 className="h-3 w-3 animate-spin" />
                                      : <Download className="h-3 w-3" />}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
