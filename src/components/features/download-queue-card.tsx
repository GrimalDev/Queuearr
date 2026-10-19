'use client';

import { AudioLines, ArrowUpToLine, Bug, Check, CircleAlert, Clock, Download, Film, Languages, Loader2, RotateCcw, Trash2, Tv, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AudioSearchIndicator } from '@/components/features/audio-search-indicator';
import { IN_CINEMAS_SEARCH_MESSAGE } from '@/lib/movie-release-status';
import { cn } from '@/lib/utils';
import type { QueueItem } from '@/types';

interface DownloadQueueCardProps {
  item: QueueItem;
  onRetry?: () => void;
  onCancelSearch?: () => void;
  onDelete?: () => void;
  onPassFirst?: () => void;
  isAdmin?: boolean;
  isRetrying?: boolean;
  isDeleting?: boolean;
  isPassing?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

export function DownloadQueueCard({ item, onRetry, onCancelSearch, onDelete, onPassFirst, isAdmin, isRetrying = false, isDeleting = false, isPassing = false }: DownloadQueueCardProps): React.JSX.Element {
  const [showDebug, setShowDebug] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!onRetry || !item.retryAvailableAt || item.retryAvailableAt <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current >= item.retryAvailableAt!) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [item.retryAvailableAt, onRetry]);
  const remaining = Math.max(0, Math.ceil(((item.retryAvailableAt ?? 0) - now) / 1000));
  const countdown = `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
  const cooldown = !isAdmin && (remaining > 0 || item.retryAvailableAt == null);
  const audio = !!item.audio;
  const Icon = audio ? AudioLines : item.source === 'radarr' ? Film : item.source === 'sonarr' ? Tv : Download;
  const phase = isRetrying ? 'searching' : item.hasError || item.isStalled || ['failed', 'warning'].includes(item.status) ? 'error' :
    item.isSearching ? 'searching' : item.isAwaitingDownload ? 'submitting' : item.audio?.phase ??
    (item.metadataPercentComplete != null && item.metadataPercentComplete < 1 ? 'metadata' :
      item.status === 'completed' || item.status === 'seeding' ? 'ready' : item.status === 'importing' ? 'importing' :
        item.status === 'pending' ? 'validating' : 'downloading');
  const labels = {
    searching: audio ? 'Searching for audio' : item.isRegrab || isRetrying && !item.canRetrySearch ? 'Searching for a replacement release' : 'Searching for a release',
    submitting: 'Waiting for the download client',
    metadata: 'Fetching torrent metadata', downloading: audio ? 'Downloading audio' : 'Downloading',
    validating: audio ? 'Checking audio and synchronization' : 'Checking download', merging: 'Merging audio', verifying: 'Verifying merged audio',
    importing: 'Importing into the library', ready: item.status === 'seeding' ? 'Seeding' : 'Ready', error: 'Error',
  };
  const waiting = !isRetrying && !item.isSearching && (item.status === 'paused' || item.status === 'queued');
  const label = phase === 'error' ? item.searchError === 'in_cinemas' ? IN_CINEMAS_SEARCH_MESSAGE : 'Error' : waiting ? item.status === 'paused' ? 'Paused' : 'Queued'
    : phase === 'downloading' && item.progress >= 100 ? audio ? 'Waiting for audio checks' : 'Waiting for import' : labels[phase];
  const step = phase === 'searching' ? 0 : phase === 'submitting' || phase === 'metadata' || phase === 'downloading' ? 1 :
    phase === 'validating' || phase === 'importing' ? 2 : 3;
  const steps = audio ? ['Search', 'Download', 'Check', 'Merge'] : ['Search', 'Download', 'Import', 'Ready'];
  const indeterminate = !waiting && (phase === 'searching' || phase === 'metadata');
  return (
    <Card className={cn(phase === 'error' && 'border-destructive/50')}>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h4 className="truncate font-semibold">{item.title}</h4>
              <p className="text-xs text-muted-foreground">{item.subtitle ? `${item.subtitle} · ` : ''}{audio ? 'Additional movie audio' : item.isRegrab ? 'Movie replacement' : item.source === 'sonarr' ? 'Series download' : 'Movie download'}</p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 font-normal"><Icon className="size-3" aria-hidden="true" />{audio ? 'Audio download' : item.source === 'sonarr' ? 'Series download' : 'Movie download'}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.quality && <Badge variant="outline" className="font-normal">{item.quality}</Badge>}
          {(item.audio?.languages ?? []).map((language) => <Badge key={language.id} variant="secondary" className="gap-1.5">
            <Languages className="size-3" aria-hidden="true" />{language.name}
          </Badge>)}
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {item.indexer || (phase === 'searching' ? 'Choosing an indexer' : 'Indexer unavailable')}
          </Badge>
        </div>
        {indeterminate ? <AudioSearchIndicator label={`${label}…`} audio={audio} /> : (
          <div role={phase === 'error' ? 'alert' : 'status'} className={cn('flex items-center gap-2 text-sm', phase === 'error' && 'text-destructive')}>
            {phase === 'error' ? <CircleAlert className="size-4" aria-hidden="true" /> : waiting ? <Clock className="size-4" aria-hidden="true" /> :
              phase === 'ready' ? <Check className="size-4" aria-hidden="true" /> : <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
            {label}
          </div>
        )}
        {phase === 'metadata' && <p className="text-xs text-muted-foreground">Waiting for peers to provide the torrent details. The download has not started yet.</p>}
        {(phase === 'downloading' || phase === 'ready' || waiting) && item.size > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatBytes(item.size - item.sizeRemaining)} / {formatBytes(item.size)}</span>
              <span className="font-medium text-foreground">{item.progress.toFixed(1)}%</span>
            </div>
            <Progress value={item.progress} aria-label={`${item.title} download`} className="h-1.5" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatBytes(item.downloadSpeed ?? 0)}/s</span>
              {item.peersConnected != null && <span className="flex items-center gap-1"><Users className="size-3" aria-hidden="true" />{item.peersConnected} peers</span>}
              {item.eta && <span>ETA {item.eta}</span>}
            </div>
          </div>
        )}
        {(onRetry || onCancelSearch || onDelete || onPassFirst || isAdmin || item.hasError && item.canRetry) && <div className="flex flex-wrap items-center gap-2">
          {!onRetry && item.hasError && (isAdmin || item.canRetry) && <Button variant="outline" size="sm" disabled title="Review is required before retrying.">Retry unavailable</Button>}
          {onRetry && <Button variant="outline" size="sm" disabled={isRetrying || isDeleting || cooldown} onClick={onRetry}
            title={isAdmin && remaining > 0 ? 'Override the five-minute retry cooldown' : undefined}>
            <RotateCcw className={cn('size-3.5', isRetrying && 'motion-safe:animate-spin')} aria-hidden="true" />
            {isRetrying ? 'Searching…' : isAdmin && remaining > 0 ? 'Retry now (admin)' : remaining > 0 ? `Retry in ${countdown}` :
              cooldown ? 'Retry unavailable' : item.canRetrySearch || item.isSearching || item.audio?.phase === 'searching' ? 'Retry search' : 'Try another release'}
          </Button>}
          {onCancelSearch && <Button variant="ghost" size="sm" aria-label={`Cancel ${item.title} search`} onClick={onCancelSearch} disabled={isDeleting || isRetrying}>
            {isDeleting ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {isDeleting ? 'Cancelling…' : 'Cancel search'}
          </Button>}
          {onPassFirst && <Button variant="ghost" size="sm" aria-label={`Download ${item.title} first`} onClick={onPassFirst} disabled={isPassing || isRetrying}>
            {isPassing ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUpToLine className="size-4" aria-hidden="true" />}
          </Button>}
          {onDelete && <Button variant="ghost" size="sm" aria-label={`Remove ${item.title} download`} onClick={onDelete} disabled={isDeleting || isRetrying}>
            {isDeleting ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          </Button>}
          {isAdmin && <Button variant="ghost" size="sm" aria-label={`Download details for ${item.title}`} aria-expanded={showDebug} onClick={() => setShowDebug((value) => !value)}>
            <Bug className="size-4" aria-hidden="true" />
          </Button>}
        </div>}
        {onRetry && isAdmin && remaining > 0 && !isRetrying && <p className="text-xs text-muted-foreground">Cooldown {countdown}. Admin override is available.</p>}
        {showDebug && <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">{JSON.stringify(
          Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'errorMessage')), null, 2)}</pre>}
        <ol aria-label={audio ? 'Audio download stages' : 'Download stages'} className="grid grid-cols-4 gap-2 border-t pt-4">
          {steps.map((name, index) => (
            <li key={name} aria-current={phase !== 'error' && index === step ? 'step' : undefined}
              className={cn('flex items-center gap-1.5 text-[11px] sm:text-xs', index > step || phase === 'error' ? 'text-muted-foreground' : 'text-foreground')}>
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                (index < step || phase === 'ready') && phase !== 'error' && 'border-foreground bg-foreground text-background',
                index === step && phase !== 'error' && 'border-foreground')}>
                {(index < step || phase === 'ready') && phase !== 'error' ? <Check className="size-3" aria-hidden="true" /> : index + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
