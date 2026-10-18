'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, Check, ChevronDown, Download, Loader2, Plus, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getPublicMovieAudioDetail, MOVIE_AUDIO_OPTIONS } from '@/lib/movie-audio-policy';
import { cn } from '@/lib/utils';
import { AudioSearchIndicator } from '@/components/features/audio-search-indicator';
import { useAppStore } from '@/store/app-store';
import type { MovieAudioLanguage, RadarrLanguage, SearchResult } from '@/types';

interface AudioStatus {
  movieId?: number;
  state?: string;
  detail?: string;
  requiredLanguages: RadarrLanguage[];
  availableLanguages: RadarrLanguage[];
  hasFile?: boolean;
}

export function MovieAudioRequest({ result }: { result: SearchResult }): React.JSX.Element {
  const { data: session } = useSession();
  const startQueueRequest = useAppStore((state) => state.startQueueRequest);
  const finishQueueRequest = useAppStore((state) => state.finishQueueRequest);
  const [language, setLanguage] = useState<MovieAudioLanguage>('original');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AudioStatus>({
    state: result.audioRequestState, detail: result.audioRequestDetail, hasFile: result.hasFile,
    requiredLanguages: result.requestedAudioLanguages ?? [], availableLanguages: result.availableAudioLanguages ?? [],
  });
  useEffect(() => {
    if (!status.state || status.state === 'available' || status.state === 'needs_review' || status.state === 'cancelled') return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/radarr/audio?tmdbId=${result.tmdbId}`);
        if (response.ok) {
          const body = await response.json() as AudioStatus;
          if (!disposed) setStatus(body);
        }
      } catch { /* Preserve the last status until the next poll. */ }
    };
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [result.tmdbId, status.state]);

  const options = MOVIE_AUDIO_OPTIONS.map((option) => {
    const id = option.value === 'english' ? 1 : option.value === 'french' ? 2 : result.originalLanguage?.id;
    return {
      ...option,
      id,
      label: option.value === 'original' && result.originalLanguage
        ? `Original (${result.originalLanguage.name})` : option.label,
      present: status.availableLanguages.some((item) => item.id === id),
    };
  });
  const publicDetail = getPublicMovieAudioDetail(status.state, status.detail);
  const selected = options.find((option) => option.value === language)!;
  const hasFile = status.hasFile ?? result.hasFile ?? false;
  const isRegrab = hasFile && selected.present;
  const actionLabel = !hasFile ? 'Grab' : selected.present ? 'Regrab' : 'Add language';
  const searchingAudio = !error && publicDetail !== 'Error' && hasFile &&
    ((busy && !selected.present) || status.state === 'pending');
  const searchingMovie = !error && publicDetail !== 'Error' && !searchingAudio &&
    (busy || status.state === 'pending' || status.state === 'regrabbing');
  const pendingLanguage = searchingAudio && !selected.present &&
    status.requiredLanguages.some((item) => item.id === selected.id);
  const submit = async (): Promise<void> => {
    setBusy(true); setError('');
    const requestId = `request-${result.tmdbId}`;
    const queueItem = {
      id: requestId, tmdbId: result.tmdbId, mediaId: result.libraryId, source: 'radarr' as const,
      title: result.title, subtitle: result.year.toString(), isSearching: true, isRegrab,
      audio: hasFile && !selected.present ? { phase: 'searching' as const,
        languages: selected.id ? [{ id: selected.id, name: selected.label }] : [] } : undefined,
      status: 'pending' as const, progress: 0, size: 0, sizeRemaining: 0, isStalled: false, hasError: false,
    };
    if (session?.user.id) startQueueRequest({ item: queueItem, userId: session.user.id });
    try {
      const response = await fetch('/api/radarr/audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: result.tmdbId, audioLanguage: language, forceDownload: hasFile }),
      });
      const body = await response.json() as AudioStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not start the download.');
      setStatus(body);
      if (body.state === 'available') finishQueueRequest(requestId);
      else if (session?.user.id) startQueueRequest({ item: { ...queueItem, mediaId: body.movieId }, userId: session.user.id, accepted: true });
    } catch { finishQueueRequest(requestId); setError('Error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-stretch gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy}
              aria-label={`Audio language for ${result.title}: ${selected.label}${selected.present ? ', already present' : ''}`}
              className={cn('h-12 min-w-0 justify-between gap-1 px-2 text-xs whitespace-normal',
                selected.present && 'border-emerald-500/70 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-500/5 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400')}>
              <span className="flex min-w-0 items-center gap-1.5 text-left leading-tight">
                {selected.present && <Check className="size-4 shrink-0 text-foreground" aria-hidden="true" />}
                <span>{selected.label}</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
            {options.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => setLanguage(option.value)}
                aria-label={`${option.label}${option.present ? ', already present' : ''}`}
                className={cn(language === option.value && 'bg-accent',
                  option.present && 'text-emerald-700 focus:text-emerald-700 dark:text-emerald-400 dark:focus:text-emerald-400')}>
                <span aria-hidden="true" className="w-4 shrink-0">{option.present && <Check className="size-4 text-foreground" />}</span>
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button className="h-12 min-w-0 gap-1.5 px-2 whitespace-normal" disabled={busy || pendingLanguage}
          aria-busy={busy || pendingLanguage}
          aria-label={`${isRegrab ? 'Already available. ' : ''}${actionLabel} ${result.title} with ${selected.label} audio`}
          onClick={() => { void submit(); }}>
          {busy || pendingLanguage ? <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> :
            isRegrab ? <RotateCw className="size-4 shrink-0" aria-hidden="true" /> :
              hasFile ? <Plus className="size-4 shrink-0" aria-hidden="true" /> : <Download className="size-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 leading-tight">
            {pendingLanguage || (busy && hasFile && !selected.present) ? 'Searching…' : busy ? 'Starting…' : isRegrab ? <><span className="block text-[10px] font-normal">Already available</span><span className="block text-sm">Regrab</span></> : actionLabel}
          </span>
        </Button>
      </div>
      {searchingAudio && <AudioSearchIndicator />}
      {searchingMovie && <AudioSearchIndicator audio={false} label={isRegrab ? 'Searching for a replacement release…' : 'Searching for a movie release…'} />}
      {!searchingAudio && !searchingMovie && !error && publicDetail && status.state !== 'available' && <p role={publicDetail === 'Error' ? 'alert' : 'status'} className={cn('text-xs', publicDetail === 'Error' ? 'text-destructive' : 'text-muted-foreground')}>{publicDetail}</p>}
      {(busy || (status.state && status.state !== 'available' && status.state !== 'cancelled')) && !error && <Button asChild variant="ghost" size="sm" className="w-full gap-2">
        <Link href="/queue">View downloads<ArrowRight className="size-4" aria-hidden="true" /></Link>
      </Button>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
