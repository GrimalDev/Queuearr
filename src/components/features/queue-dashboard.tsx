'use client';

import { useState } from 'react';
import {
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pause,
  RefreshCw,
  Film,
  Tv,
  HardDrive,
  RotateCcw,
  Trash2,
  Users,
  Bug,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from 'next-auth/react';
import { useQueue } from '@/hooks/use-media';
import { QueueItem, QueueItemStatus } from '@/types';
import { cn } from '@/lib/utils';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const statusConfig: Record<
  QueueItemStatus,
  { icon: typeof Download; color: string; label: string }
> = {
  downloading: { icon: Download, color: 'text-blue-500', label: 'Downloading' },
  seeding: { icon: CheckCircle2, color: 'text-green-500', label: 'Seeding' },
  paused: { icon: Pause, color: 'text-yellow-500', label: 'Paused' },
  queued: { icon: Clock, color: 'text-gray-500', label: 'Queued' },
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Failed' },
  warning: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Warning' },
  importing: { icon: HardDrive, color: 'text-purple-500', label: 'Importing' },
  pending: { icon: Clock, color: 'text-gray-500', label: 'Pending' },
};

function QueueItemCard({
  item,
  onRetry,
  onDelete,
  isAdmin,
  isRetrying = false,
  isDeleting = false,
}: {
  item: QueueItem;
  onRetry?: () => void;
  onDelete?: () => void;
  isAdmin?: boolean;
  isRetrying?: boolean;
  isDeleting?: boolean;
}) {
  const [showDebug, setShowDebug] = useState(false);
  const config = statusConfig[item.status];
  const StatusIcon = config.icon;

  return (
    <Card className={cn('transition-all', item.hasError && !isRetrying && 'border-red-500/50', isRetrying && 'border-blue-500/50')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {item.source === 'radarr' && <Film className="h-4 w-4 text-muted-foreground" />}
              {item.source === 'sonarr' && <Tv className="h-4 w-4 text-muted-foreground" />}
              {item.source === 'transmission' && (
                <Download className="h-4 w-4 text-muted-foreground" />
              )}
              <h4 className="font-medium truncate">{item.title}</h4>
            </div>
            {item.subtitle && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isRetrying ? (
              <RotateCcw className="h-4 w-4 text-blue-500 animate-spin" />
            ) : (
              <StatusIcon className={cn('h-4 w-4', config.color)} />
            )}
            <Badge
              variant={
                isRetrying
                  ? 'secondary'
                  : item.status === 'failed' || item.hasError
                    ? 'destructive'
                    : item.status === 'completed'
                      ? 'default'
                      : 'secondary'
              }
              className={isRetrying ? 'text-blue-500' : undefined}
            >
              {isRetrying ? 'Retrying' : item.hasError ? 'Error' : config.label}
            </Badge>
            {isAdmin && !isRetrying && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground"
                onClick={() => setShowDebug((v) => !v)}
              >
                {showDebug ? <ChevronUp className="h-3.5 w-3.5" /> : <Bug className="h-3.5 w-3.5" />}
              </Button>
            )}
            {onDelete && !isRetrying && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
                disabled={isDeleting}
              >
                {isDeleting
                  ? <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {formatBytes(item.size - item.sizeRemaining)} / {formatBytes(item.size)}
            </span>
            <span className="font-medium">{item.progress.toFixed(1)}%</span>
          </div>
          <Progress value={item.progress} className="h-2" />
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          {item.peersConnected != null ? (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {item.peersSendingToUs ?? 0}/{item.peersConnected}
            </span>
          ) : <span />}
          <div className="flex items-center gap-2">
            {item.eta && item.status === 'downloading' && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                ETA: {item.eta}
              </span>
            )}
            {!item.hasError && !item.isStalled && !isRetrying && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-muted-foreground hover:text-foreground"
                onClick={onRetry}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Force Retry
              </Button>
            )}
          </div>
        </div>

        {isRetrying && (
          <div className="mt-3 p-2 rounded-md bg-blue-500/10 text-blue-500 text-sm">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 flex-shrink-0 animate-spin" />
              <span>Searching for a replacement release…</span>
            </div>
          </div>
        )}

        {item.hasError && !isRetrying && (
          <div className="mt-3 p-2 rounded-md bg-red-500/10 text-red-500 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{item.errorMessage || 'Download error'}</span>
              </div>
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                  onClick={onRetry}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}

        {item.isStalled && !item.hasError && !isRetrying && (
          <div className="mt-3 p-2 rounded-md bg-yellow-500/10 text-yellow-600 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Download appears to be stalled</span>
            </div>
          </div>
        )}

        {showDebug && (
          <div className="mt-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <Bug className="h-3 w-3" />
              Debug
            </div>
            {item.indexer && (
              <div className="mb-2 flex items-center gap-2 text-xs font-mono">
                <span className="text-muted-foreground">indexer</span>
                <span className="font-semibold text-foreground">{item.indexer}</span>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
              {(Object.entries(item) as [string, unknown][]).map(([key, value]) => {
                // Unix-seconds timestamps from Transmission
                const epochSecKeys = ['addedDate', 'doneDate', 'activityDate'];
                // Unix-ms timestamps from our DB
                const epochMsKeys = ['dbCreatedAt', 'dbLastActivityAt', 'dbLastBytesAt'];
                // ISO string dates from Radarr/Sonarr
                const isoDateKeys = ['estimatedCompletionTime'];
                let display: React.ReactNode;
                if (value === null || value === undefined) {
                  display = <span className="text-muted-foreground/50">—</span>;
                } else if (epochSecKeys.includes(key) && typeof value === 'number') {
                  display = value > 0
                    ? new Date(value * 1000).toLocaleString()
                    : <span className="text-muted-foreground/50">—</span>;
                } else if (epochMsKeys.includes(key) && typeof value === 'number') {
                  display = new Date(value).toLocaleString();
                } else if (isoDateKeys.includes(key) && typeof value === 'string') {
                  const d = new Date(value);
                  display = isNaN(d.getTime())
                    ? value
                    : d.toLocaleString();
                } else {
                  display = String(value);
                }
                return (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground truncate">{key}</dt>
                    <dd className="text-foreground truncate">{display}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function QueueDashboard() {
  const { queueItems, isLoadingQueue, lastFetch, refresh } = useQueue();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingItems, setRetryingItems] = useState<Map<string, QueueItem>>(new Map());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const handleForceDelete = async (item: QueueItem) => {
    if (!item.sourceId || (item.source !== 'radarr' && item.source !== 'sonarr')) return;
    setDeletingIds((prev) => new Set(prev).add(item.id));
    try {
      await fetch(`/api/${item.source}/queue`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.sourceId], retry: false, mediaId: item.mediaId }),
      });
      await refresh();
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleRetry = async (item: QueueItem) => {
    if (!item.sourceId || (item.source !== 'radarr' && item.source !== 'sonarr')) return;
    setRetryingItems((prev) => new Map(prev).set(item.id, item));
    try {
      await fetch(`/api/${item.source}/queue`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.sourceId], retry: true, mediaId: item.mediaId, episodeId: item.episodeId }),
      });
      await refresh();
    } catch {
      // On failure, remove from retrying so the error state is visible again
      setRetryingItems((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const activeDownloads = queueItems.filter(
    (item) => item.status === 'downloading' || item.status === 'seeding'
  );
  const problemItems = queueItems.filter((item) => item.hasError || item.isStalled);
  const queuedItems = queueItems.filter(
    (item) => item.status === 'queued' || item.status === 'pending'
  );

  // Items that were retried and left the queue — show them as "retrying" until next refresh brings a new result
  const retryingOnlyItems = Array.from(retryingItems.values()).filter(
    (retrying) => !queueItems.some((q) => q.id === retrying.id)
  );
  const allProblemItems = [
    ...problemItems,
    ...retryingOnlyItems,
  ];

  if (isLoadingQueue && queueItems.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Download Queue</h2>
          {lastFetch && (
            <p className="text-sm text-muted-foreground">
              Last updated: {lastFetch.toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Downloads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeDownloads.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Queued
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queuedItems.length}</div>
          </CardContent>
        </Card>
        <Card className={cn(allProblemItems.length > 0 && 'border-red-500/50')}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Problems</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                'text-2xl font-bold flex items-center gap-2',
                allProblemItems.length > 0 ? 'text-red-500' : 'text-green-500'
              )}
            >
              {allProblemItems.length > 0 ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {allProblemItems.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {allProblemItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-red-500 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Issues Detected
          </h3>
          {allProblemItems.map((item) => (
            <QueueItemCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              isRetrying={retryingItems.has(item.id)}
              isDeleting={deletingIds.has(item.id)}
              onRetry={item.hasError && item.sourceId && !retryingItems.has(item.id) ? () => handleRetry(item) : undefined}
              onDelete={item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) && !deletingIds.has(item.id) ? () => handleForceDelete(item) : undefined}
            />
          ))}
        </div>
      )}

      {activeDownloads.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Active Downloads</h3>
          <div className="space-y-3">
            {activeDownloads.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                isRetrying={retryingItems.has(item.id)}
                isDeleting={deletingIds.has(item.id)}
                onRetry={item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) ? () => handleRetry(item) : undefined}
                onDelete={item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) && !deletingIds.has(item.id) ? () => handleForceDelete(item) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {queuedItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-muted-foreground">Queued</h3>
          <div className="space-y-3">
            {queuedItems.map((item) => (
              <QueueItemCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                isRetrying={retryingItems.has(item.id)}
                isDeleting={deletingIds.has(item.id)}
                onRetry={item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) ? () => handleRetry(item) : undefined}
                onDelete={item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) && !deletingIds.has(item.id) ? () => handleForceDelete(item) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {queueItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <Download className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">No active downloads</h3>
          <p className="text-muted-foreground mt-1">
            Add some media to start downloading
          </p>
        </div>
      )}
    </div>
  );
}
