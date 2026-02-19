import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { createTransmissionClient } from '@/lib/api/transmission';
import { sendToUser } from '@/lib/push';
import {
  getActiveMonitoredDownloads,
  updateDownloadStatus,
  markDownloadCompleted,
  updateDownloadActivity,
  upsertMonitoredDownload,
} from '@/lib/db/monitored-downloads';
import type { RadarrQueueItem, SonarrQueueItem, TransmissionTorrent } from '@/types';

type DownloadStatus = 'downloading' | 'queued' | 'importing' | 'warning' | 'failed' | 'stalled' | 'error';

const STATUS_PRIORITY: DownloadStatus[] = ['error', 'failed', 'stalled', 'warning', 'importing', 'downloading', 'queued'];

// Stall thresholds
const BYTES_STALL_MS = 15 * 60 * 1000;       // 15 min without bytes while downloading
const NEVER_STARTED_STALL_MS = 30 * 60 * 1000; // 30 min from created_at with no bytes ever

function resolveStatus(
  items: { status: string; trackedDownloadState?: string; trackedDownloadStatus?: string; errorMessage?: string; downloadId?: string }[],
  torrentsByHash: Map<string, TransmissionTorrent>
): DownloadStatus | null {
  if (items.length === 0) return null;

  const statuses = items.map((item) => {
    const s = item.status?.toLowerCase() ?? '';
    const tds = item.trackedDownloadState?.toLowerCase() ?? '';
    const tss = item.trackedDownloadStatus?.toLowerCase() ?? '';

    if (item.errorMessage || tss === 'error') return 'error' as DownloadStatus;
    if (s === 'failed' || tds === 'downloadfailed') return 'failed' as DownloadStatus;
    if (tds === 'stalled' || (tss === 'warning' && tds.includes('stall'))) return 'stalled' as DownloadStatus;
    if (tss === 'warning') return 'warning' as DownloadStatus;
    if (s === 'importing' || tds === 'importpending' || tds === 'importing') return 'importing' as DownloadStatus;

    // Cross-reference with Transmission using the torrent hash (downloadId)
    if (item.downloadId) {
      const torrent = torrentsByHash.get(item.downloadId.toLowerCase());
      if (torrent) {
        const transmission = createTransmissionClient();
        if (transmission) {
          const { isProblematic } = transmission.isProblematic(torrent);
          if (isProblematic) {
            // Distinguish error (local error / tracker error) from stall
            if (torrent.error > 0) return 'error' as DownloadStatus;
            return 'stalled' as DownloadStatus;
          }
        }
      }
    }

    if (s === 'downloading' || tds === 'downloading') return 'downloading' as DownloadStatus;
    return 'queued' as DownloadStatus;
  });

  for (const priority of STATUS_PRIORITY) {
    if (statuses.includes(priority)) return priority;
  }
  return 'queued';
}

const NOTIFICATION_MESSAGES: Record<string, { title: (t: string) => string; body: string }> = {
  downloading: {
    title: (t) => `${t} started downloading`,
    body: 'Your download is now active',
  },
  failed: {
    title: (t) => `${t} download failed`,
    body: 'The download encountered an error',
  },
  error: {
    title: (t) => `${t} download failed`,
    body: 'The download encountered an error',
  },
  stalled: {
    title: (t) => `${t} download is stalled`,
    body: 'No peers are sending data',
  },
  importing: {
    title: (t) => `${t} is being imported`,
    body: 'Almost ready!',
  },
  warning: {
    title: (t) => `${t} has a warning`,
    body: 'Check the queue for details',
  },
};

const READY_NOTIFICATION = {
  title: (t: string) => `${t} is ready!`,
  body: 'Your download has completed',
};

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function checkDownloads(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    let monitored = await getActiveMonitoredDownloads();

    console.log(`[watcher] checking ${monitored.length} downloads`);

    const radarr = createRadarrClient();
    const sonarr = createSonarrClient();
    const transmission = createTransmissionClient();

    const [radarrQueue, sonarrQueue, transmissionTorrents] = await Promise.all([
      radarr
        ? radarr.getQueue(false).then((q) => q.records).catch(() => [] as RadarrQueueItem[])
        : Promise.resolve([] as RadarrQueueItem[]),
      sonarr
        ? sonarr.getQueue().then((q) => q.records).catch(() => [] as SonarrQueueItem[])
        : Promise.resolve([] as SonarrQueueItem[]),
      transmission
        ? transmission.getTorrents().catch(() => [] as TransmissionTorrent[])
        : Promise.resolve([] as TransmissionTorrent[]),
    ]);

    // Build hash → torrent map for O(1) lookup (hashes are lowercase in Transmission)
    const torrentsByHash = new Map<string, TransmissionTorrent>(
      transmissionTorrents.map((t) => [t.hashString.toLowerCase(), t])
    );

    // Auto-discover untracked queue items (e.g. added directly in Radarr/Sonarr UI)
    const trackedRadarrIds = new Set(
      monitored.filter((d) => d.source === 'radarr').map((d) => d.mediaId)
    );
    const trackedSonarrIds = new Set(
      monitored.filter((d) => d.source === 'sonarr').map((d) => d.mediaId)
    );

    let discovered = false;
    for (const item of radarrQueue) {
      if (item.movieId && !trackedRadarrIds.has(item.movieId)) {
        const title = (item as RadarrQueueItem & { movie?: { title?: string } }).movie?.title ?? item.title ?? String(item.movieId);
        await upsertMonitoredDownload('radarr', item.movieId, title);
        discovered = true;
      }
    }
    for (const item of sonarrQueue) {
      if (item.seriesId && !trackedSonarrIds.has(item.seriesId)) {
        const title = (item as SonarrQueueItem & { series?: { title?: string } }).series?.title ?? item.title ?? String(item.seriesId);
        await upsertMonitoredDownload('sonarr', item.seriesId, title);
        discovered = true;
      }
    }
    if (discovered) {
      monitored = await getActiveMonitoredDownloads();
    }

    for (const download of monitored) {
      const queueItems =
        download.source === 'radarr'
          ? radarrQueue.filter((item) => item.movieId === download.mediaId)
          : sonarrQueue.filter((item) => item.seriesId === download.mediaId);

      // Find matched torrent for this download
      const matchedTorrent = queueItems
        .map((item) => item.downloadId ? torrentsByHash.get(item.downloadId.toLowerCase()) : undefined)
        .find((t) => t !== undefined) ?? null;

      // Update activity timestamps whenever the download is in the queue
      if (queueItems.length > 0) {
        const hasBytesActivity = (matchedTorrent?.rateDownload ?? 0) > 0;
        await updateDownloadActivity(download.id, hasBytesActivity);
      }

      let effectiveStatus = resolveStatus(queueItems, torrentsByHash);

      if (queueItems.length === 0 && download.lastStatus !== null) {
        // Left the queue → completed
        await Promise.all(
          download.userIds.map((userId) =>
            sendToUser(userId, {
              title: READY_NOTIFICATION.title(download.title),
              body: READY_NOTIFICATION.body,
              tag: `download-complete-${download.id}`,
            })
          )
        );
        await markDownloadCompleted(download.id);
        continue;
      }

      // Timestamp-based stall check (independent of Transmission's own stall detection)
      if (effectiveStatus !== null) {
        const now = Date.now();
        const isActiveDownload = effectiveStatus === 'downloading' || effectiveStatus === 'queued';
        const hasRemainingWork = matchedTorrent ? matchedTorrent.leftUntilDone > 0 : true;

        if (isActiveDownload && hasRemainingWork) {
          if (download.lastBytesAt !== null) {
            if (now - download.lastBytesAt > BYTES_STALL_MS) effectiveStatus = 'stalled';
          } else if (now - download.createdAt > NEVER_STARTED_STALL_MS) {
            effectiveStatus = 'stalled';
          }
        }
      }

      if (effectiveStatus && effectiveStatus !== download.lastStatus) {
        const msg = NOTIFICATION_MESSAGES[effectiveStatus];
        if (msg) {
          await Promise.all(
            download.userIds.map((userId) =>
              sendToUser(userId, {
                title: msg.title(download.title),
                body: msg.body,
                tag: `download-status-${download.id}`,
              })
            )
          );
        }
        await updateDownloadStatus(download.id, effectiveStatus);
      }
    }
  } catch (error) {
    console.error('[watcher] error during check:', error);
  } finally {
    isRunning = false;
  }
}

export function startWatcher(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(checkDownloads, 30_000);
  console.log('[watcher] started');
}
