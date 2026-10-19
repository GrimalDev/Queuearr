'use client';

import { useState } from 'react';
import { Download, AlertTriangle, CheckCircle2, RefreshCw, Film, Tv, AudioLines } from 'lucide-react';
import { DownloadQueueCard } from '@/components/features/download-queue-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from 'next-auth/react';
import { useQueue } from '@/hooks/use-media';
import { useAppStore } from '@/store/app-store';
import { QueueItem } from '@/types';
import { cn } from '@/lib/utils';
import { matchesQueueRequest } from '@/lib/queue-requests';
import { orderDownloadQueue } from '@/lib/download-queue-order';

export function QueueDashboard() {
  const [queueFilter, setQueueFilter] = useState<'mine' | 'all'>('mine');
  const [showSeeding, setShowSeeding] = useState(false);
  const { queueItems, isLoadingQueue, queueErrors, lastFetch, refresh } = useQueue(queueFilter);
  const setQueueItems = useAppStore((state) => state.setQueueItems);
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingItems, setRetryingItems] = useState<Map<string, QueueItem>>(new Map());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [passingIds, setPassingIds] = useState<Set<string>>(new Set());

  const updateRetryTime = async (item: QueueItem, response: Response): Promise<void> => {
    const body = await response.json().catch(() => null) as { retryAvailableAt?: unknown } | null;
    if (typeof body?.retryAvailableAt === 'number') {
      const retryAvailableAt = body.retryAvailableAt;
      const current = useAppStore.getState().queueItems;
      setQueueItems(current.map((entry) => entry.id === item.id ? { ...entry, retryAvailableAt } : entry));
    }
    if (!response.ok) throw new Error('Error');
  };

  const handleForceDelete = async (item: QueueItem) => {
    if (!item.sourceId || (item.source !== 'radarr' && item.source !== 'sonarr')) return;
    setDeletingIds((prev) => new Set(prev).add(item.id));
    try {
      const response = await fetch(`/api/${item.source}/queue`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.sourceId], retry: false, mediaId: item.mediaId }),
      });
      if (!response.ok) throw new Error('Error');
      await refresh();
    } catch {
      useAppStore.getState().addAlert({ type: 'error', title: 'Error', message: 'Error', source: item.source, relatedItemId: item.id });
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleCancelSearch = async (item: QueueItem): Promise<void> => {
    if (!item.mediaId || item.source === 'transmission') return;
    setDeletingIds((previous) => new Set(previous).add(item.id));
    try {
      const response = await fetch('/api/downloads/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, mediaId: item.mediaId }),
      });
      if (!response.ok) throw new Error('Error');
      const store = useAppStore.getState();
      for (const pending of store.pendingQueueRequests) {
        if (matchesQueueRequest(item, pending.item)) store.finishQueueRequest(pending.item.id);
      }
      setQueueItems(store.queueItems.filter((entry) => !matchesQueueRequest(entry, item)));
      await refresh();
    } catch {
      useAppStore.getState().addAlert({ type: 'error', title: 'Error', message: 'Error', source: item.source, relatedItemId: item.id });
      await refresh();
    } finally {
      setDeletingIds((previous) => { const next = new Set(previous); next.delete(item.id); return next; });
    }
  };

  const handleRetry = async (item: QueueItem) => {
    if (!item.sourceId || (item.source !== 'radarr' && item.source !== 'sonarr')) return;
    setRetryingItems((prev) => new Map(prev).set(item.id, item));
    try {
      const response = await fetch(`/api/${item.source}/queue`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.sourceId], retry: true, mediaId: item.mediaId, episodeId: item.episodeId }),
      });
      await updateRetryTime(item, response);
      await refresh();
    } catch {
      useAppStore.getState().addAlert({ type: 'error', title: 'Error', message: 'Error', source: item.source, relatedItemId: item.id });
    } finally {
      // Always clear the retrying state — on success the new item appears in the
      // queue with a different id, so we must not keep the stale entry around.
      setRetryingItems((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleAudioRetry = async (item: QueueItem): Promise<void> => {
    if (!item.tmdbId) return;
    setRetryingItems((previous) => new Map(previous).set(item.id, item));
    try {
      const response = await fetch('/api/radarr/audio/alternative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: item.tmdbId }),
      });
      await updateRetryTime(item, response);
      await refresh();
    } catch {
      useAppStore.getState().addAlert({ type: 'error', title: 'Error', message: 'Error', source: 'radarr', relatedItemId: item.id });
    } finally {
      setRetryingItems((previous) => { const next = new Map(previous); next.delete(item.id); return next; });
    }
  };

  const handleSearchRetry = async (item: QueueItem): Promise<void> => {
    if (!item.mediaId || item.source === 'transmission') return;
    setRetryingItems((previous) => new Map(previous).set(item.id, item));
    try {
      const response = await fetch('/api/downloads/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, mediaId: item.mediaId }),
      });
      await updateRetryTime(item, response);
      await refresh();
    } catch {
      useAppStore.getState().addAlert({ type: 'error', title: 'Error', message: 'Error', source: item.source, relatedItemId: item.id });
    } finally {
      setRetryingItems((previous) => { const next = new Map(previous); next.delete(item.id); return next; });
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const getRemainingEstimate = (item: QueueItem) => {
    if (item.status !== 'downloading') {
      return Number.NEGATIVE_INFINITY;
    }
    if (item.eta) {
      const [hours, minutes, seconds] = item.eta.split(':').map((value) => Number.parseInt(value, 10));
      if (!Number.isNaN(hours) && !Number.isNaN(minutes) && !Number.isNaN(seconds)) {
        return hours * 3600 + minutes * 60 + seconds;
      }
    }
    if (item.downloadSpeed && item.downloadSpeed > 0) {
      return item.sizeRemaining / item.downloadSpeed;
    }
    return item.sizeRemaining;
  };

  const applyOptimisticPrioritize = (items: QueueItem[], item: QueueItem): QueueItem[] => {
    const target = items.find((entry) => entry.id === item.id);
    if (!target) return items;

    const pauseCandidate = items
      .filter(
        (entry) =>
          entry.id !== item.id &&
          entry.status === 'downloading' &&
          entry.downloadSpeed !== undefined &&
          entry.downloadSpeed > 0 &&
          entry.sizeRemaining > 0
      )
      .reduce<QueueItem | null>((current, entry) => {
        if (!current) return entry;
        return getRemainingEstimate(entry) > getRemainingEstimate(current) ? entry : current;
      }, null);

    const updatedTarget: QueueItem = {
      ...target,
      status: 'downloading',
    };

    const updatedPause: QueueItem | null = pauseCandidate
      ? {
          ...pauseCandidate,
          status: 'paused',
        }
      : null;

    const remaining = items.filter(
      (entry) => entry.id !== updatedTarget.id && entry.id !== updatedPause?.id
    );

    return [updatedTarget, ...(updatedPause ? [updatedPause] : []), ...remaining];
  };

  const handlePassFirst = async (item: QueueItem) => {
    const id = item.transmissionId ?? item.transmissionHash;
    if (!id) return;
    setPassingIds((prev) => new Set(prev).add(item.id));
    setQueueItems(applyOptimisticPrioritize(queueItems, item));
    try {
      await fetch('/api/transmission/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await refresh();
    } catch (error) {
      console.error('Failed to prioritize download:', error);
      await refresh();
    } finally {
      setPassingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const visibleQueueItems = queueItems.filter((item) => (isAdmin && showSeeding) || item.status !== 'seeding');
  const problemItems = visibleQueueItems.filter((item) => item.hasError || item.isStalled);
  const nonProblemItems = visibleQueueItems.filter((item) => !item.hasError && !item.isStalled);
  const activeDownloads = nonProblemItems.filter(
    (item) => item.status === 'downloading' || item.status === 'seeding' || item.status === 'importing'
  );
  const queuedItems = nonProblemItems.filter(
    (item) => item.status === 'queued' || item.status === 'pending' || item.status === 'paused'
  );

  // Items that were retried and left the queue — show them as "retrying" until next refresh brings a new result
  const retryingOnlyItems = Array.from(retryingItems.values()).filter(
    (retrying) => !queueItems.some((q) => q.id === retrying.id)
  );
  const allProblemItems = [
    ...problemItems,
    ...retryingOnlyItems,
  ];
  const orderedItems = orderDownloadQueue([...retryingOnlyItems, ...visibleQueueItems], new Set(retryingItems.keys()));

  // Show error state when services fail to connect
  const hasConnectionErrors = queueErrors.length > 0;
  const allServicesFailed = ['radarr', 'sonarr', 'transmission'].every((service) => queueErrors.some((error) => error.service === service));
  // Track if we're in a "filter switching" state (loading with no items)
  const isFilterSwitching = isLoadingQueue && queueItems.length === 0 && !hasConnectionErrors;

  // Skeleton component for queue items area only
  const QueueItemsSkeleton = () => (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );

  // Connection error state - show meaningful message instead of infinite loading
  if (hasConnectionErrors && queueItems.length === 0) {
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-1 text-sm">
              <Button
                type="button"
                variant={queueFilter === 'mine' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setQueueFilter('mine');
                  refresh();
                }}
              >
                My downloads
              </Button>
              <Button
                type="button"
                variant={queueFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  setQueueFilter('all');
                  refresh();
                }}
              >
                All downloads
              </Button>
              {isAdmin && (
                <Button
                  type="button"
                  variant={showSeeding ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setShowSeeding((visible) => !visible)}
                >
                  {showSeeding ? 'Hide seeding' : 'Show seeding'}
                </Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="border-red-500/50">
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-full bg-red-500/10 p-4 mb-4">
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-red-500">
                {allServicesFailed ? 'Unable to Connect to Services' : 'Some Services Unavailable'}
              </h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                {allServicesFailed
                  ? 'Could not connect to any download services. Please check your configuration and ensure the services are running.'
                  : 'Some services are not responding. Downloads from available services will still be shown.'}
              </p>
              <div className="mt-6 space-y-2 w-full max-w-md">
                {queueErrors.map((error) => (
                  <div
                    key={error.service}
                    className="flex items-center justify-between p-3 rounded-md bg-muted/50 border border-red-500/20"
                  >
                    <div className="flex items-center gap-2">
                      {error.service === 'radarr' && <Film className="h-4 w-4 text-muted-foreground" />}
                      {error.service === 'sonarr' && <Tv className="h-4 w-4 text-muted-foreground" />}
                      {error.service === 'transmission' && <Download className="h-4 w-4 text-muted-foreground" />}
                      {error.service === 'audio' && <AudioLines className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium capitalize">{error.service}</span>
                    </div>
                    <span className="text-sm text-red-500 truncate max-w-[200px]" title={error.message}>
                      {error.message.length > 50 ? error.message.substring(0, 50) + '...' : error.message}
                    </span>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="mt-6" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-1 text-sm">
            <Button
              type="button"
              variant={queueFilter === 'mine' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setQueueFilter('mine')}
            >
              My downloads
            </Button>
            <Button
              type="button"
              variant={queueFilter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setQueueFilter('all')}
              >
                All downloads
              </Button>
              {isAdmin && (
                <Button
                  type="button"
                  variant={showSeeding ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setShowSeeding((visible) => !visible)}
                >
                  {showSeeding ? 'Hide seeding' : 'Show seeding'}
                </Button>
              )}
            </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Downloads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFilterSwitching ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{activeDownloads.length}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Queued
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFilterSwitching ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{queuedItems.length}</div>
            )}
          </CardContent>
        </Card>
        <Card className={cn(!isFilterSwitching && allProblemItems.length > 0 && 'border-red-500/50')}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Problems</CardTitle>
          </CardHeader>
          <CardContent>
            {isFilterSwitching ? (
              <Skeleton className="h-8 w-12" />
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Show skeletons when filter is switching */}
      {isFilterSwitching && <QueueItemsSkeleton />}

      {/* Show queue items when not switching */}
      {!isFilterSwitching && orderedItems.length > 0 && (
        <div className="space-y-3">
          {orderedItems.map((item) => (
            <DownloadQueueCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              isRetrying={retryingItems.has(item.id)}
              isDeleting={deletingIds.has(item.id)}
              isPassing={passingIds.has(item.id)}
              onRetry={item.audio?.canRetry ? () => handleAudioRetry(item) : item.canRetrySearch ? () => handleSearchRetry(item) :
                !item.audio && !item.requiresSelection && (isAdmin || item.canRetry) && item.sourceId && (item.hasError || item.isStalled || !['importing', 'seeding', 'completed'].includes(item.status)) && (item.source === 'radarr' || item.source === 'sonarr') ? () => handleRetry(item) : undefined}
              onCancelSearch={(item.canCancelSearch ?? item.canRetrySearch) ? () => handleCancelSearch(item) : undefined}
              onDelete={!item.audio && item.sourceId && (item.source === 'radarr' || item.source === 'sonarr') && !retryingItems.has(item.id) && !deletingIds.has(item.id) ? () => handleForceDelete(item) : undefined}
              onPassFirst={!item.audio && isAdmin && (item.transmissionId ?? item.transmissionHash) && (item.status === 'queued' || item.status === 'pending')
                ? () => handlePassFirst(item)
                : undefined}
            />
          ))}
        </div>
      )}

      {!isFilterSwitching && visibleQueueItems.length === 0 && (
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
