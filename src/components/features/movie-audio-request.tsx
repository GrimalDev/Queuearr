'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, ChevronDown, Download, Loader2, Plus, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MOVIE_AUDIO_OPTIONS } from '@/lib/movie-audio-policy';
import { cn } from '@/lib/utils';
import type { MovieAudioLanguage, RadarrLanguage, SearchResult } from '@/types';

interface AudioStatus {
  state?: string;
  detail?: string;
  requiredLanguages: RadarrLanguage[];
  availableLanguages: RadarrLanguage[];
  hasFile?: boolean;
}

export function MovieAudioRequest({ result }: { result: SearchResult }): React.JSX.Element {
  const { data: session } = useSession();
  const [language, setLanguage] = useState<MovieAudioLanguage>('original');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AudioStatus>({
    state: result.audioRequestState, detail: result.audioRequestDetail, hasFile: result.hasFile,
    requiredLanguages: result.requestedAudioLanguages ?? [], availableLanguages: result.availableAudioLanguages ?? [],
  });
  useEffect(() => {
    if (!status.state || status.state === 'available' || status.state === 'needs_review') return;
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
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [result.tmdbId, status.state]);

  const options = MOVIE_AUDIO_OPTIONS.map((option) => {
    const id = option.value === 'english' ? 1 : option.value === 'french' ? 2 : result.originalLanguage?.id;
    return {
      ...option,
      label: option.value === 'original' && result.originalLanguage
        ? `Original (${result.originalLanguage.name})` : option.label,
      present: status.availableLanguages.some((item) => item.id === id),
    };
  });
  const selected = options.find((option) => option.value === language)!;
  const hasFile = status.hasFile ?? result.hasFile ?? false;
  const isRegrab = hasFile && selected.present;
  const actionLabel = !hasFile ? 'Grab' : selected.present ? 'Regrab' : 'Add language';
  const submit = async (): Promise<void> => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/radarr/audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: result.tmdbId, audioLanguage: language, forceDownload: hasFile }),
      });
      const body = await response.json() as AudioStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not start the download.');
      setStatus(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the download.'); }
    finally { setBusy(false); }
  };
  const retry = async (): Promise<void> => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/radarr/audio/retry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tmdbId: result.tmdbId }),
      });
      const body = await response.json() as { state: string; detail: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not retry.');
      setStatus((previous) => ({ ...previous, state: body.state, detail: body.detail }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retry.'); }
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
        <Button className="h-12 min-w-0 gap-1.5 px-2 whitespace-normal" disabled={busy}
          aria-label={`${isRegrab ? 'Already available. ' : ''}${actionLabel} ${result.title} with ${selected.label} audio`}
          onClick={() => { void submit(); }}>
          {busy ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" /> :
            isRegrab ? <RotateCw className="size-4 shrink-0" aria-hidden="true" /> :
              hasFile ? <Plus className="size-4 shrink-0" aria-hidden="true" /> : <Download className="size-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 leading-tight">
            {busy ? 'Starting…' : isRegrab ? <><span className="block text-[10px] font-normal">Already available</span><span className="block text-sm">Regrab</span></> : actionLabel}
          </span>
        </Button>
      </div>
      {status.detail && status.state !== 'available' && <p role="status" className="text-xs text-muted-foreground">{status.detail}</p>}
      {status.state === 'needs_review' && session?.user.role === 'admin' && (
        <Button className="w-full" variant="outline" disabled={busy} onClick={() => { void retry(); }}>Retry after review</Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
