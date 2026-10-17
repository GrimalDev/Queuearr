'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, Languages, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MOVIE_AUDIO_OPTIONS, isMovieAudioLanguage } from '@/lib/movie-audio-policy';
import type { MovieAudioLanguage, RadarrLanguage, SearchResult } from '@/types';

interface AudioStatus {
  state?: string;
  detail?: string;
  requiredLanguages: RadarrLanguage[];
  availableLanguages: RadarrLanguage[];
}
export function MovieAudioRequest({ result }: { result: SearchResult }): React.JSX.Element {
  const { data: session } = useSession();
  const [language, setLanguage] = useState<MovieAudioLanguage>('original');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<AudioStatus>({
    state: result.audioRequestState, detail: result.audioRequestDetail,
    requiredLanguages: result.requestedAudioLanguages ?? [], availableLanguages: result.availableAudioLanguages ?? [],
  });
  useEffect(() => {
    if (!status.state || status.state === 'available' || status.state === 'needs_review') return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/radarr/audio?tmdbId=${result.tmdbId}`);
        if (response.ok && !disposed) setStatus(await response.json() as AudioStatus);
      } catch { /* Preserve the last status until the next poll. */ }
    };
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [result.tmdbId, status.state]);
  const languageId = language === 'english' ? 1 : language === 'french' ? 2 : result.originalLanguage?.id;
  const available = status.availableLanguages.some((item) => item.id === languageId);
  const requested = status.requiredLanguages.some((item) => item.id === languageId);
  const submit = async (): Promise<void> => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/radarr/audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: result.tmdbId, audioLanguage: language }),
      });
      const body = await response.json() as AudioStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not request audio.');
      setStatus(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not request audio.'); }
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
      <label className="flex items-center gap-2 text-sm">
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">Audio language for {result.title}</span>
        <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={language}
          onChange={(event) => { if (isMovieAudioLanguage(event.target.value)) setLanguage(event.target.value); }} disabled={busy}>
          {MOVIE_AUDIO_OPTIONS.map((option) => <option key={option.value} value={option.value}>
            {option.label}{option.value === 'original' && result.originalLanguage ? ` (${result.originalLanguage.name})` : ''}
          </option>)}
        </select>
      </label>
      <Button className="w-full" disabled={busy || available || status.state === 'needs_review'} onClick={() => { void submit(); }}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : available ? <Check className="mr-2 h-4 w-4" /> : <Languages className="mr-2 h-4 w-4" />}
        {busy ? 'Saving request…' : available ? 'Audio available' : requested ? 'Follow audio request' : 'Request audio'}
      </Button>
      {status.availableLanguages.length > 0 && <p className="text-xs text-muted-foreground">Available: {status.availableLanguages.map((item) => item.name).join(', ')}</p>}
      {status.requiredLanguages.length > 0 && <p className="text-xs text-muted-foreground">Requested: {status.requiredLanguages.map((item) => item.name).join(', ')}</p>}
      {status.detail && <p role="status" className="text-xs text-muted-foreground">{status.detail}</p>}
      {status.state === 'needs_review' && session?.user.role === 'admin' && (
        <Button className="w-full" variant="outline" disabled={busy} onClick={() => { void retry(); }}>Retry after review</Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
