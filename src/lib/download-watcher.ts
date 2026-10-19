import { acquireMovieAudioLock, releaseMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
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
  getLatestMonitoredDownloadBySourceMedia,
} from '@/lib/db/monitored-downloads';
import type { RadarrQueueItem, SonarrQueueItem, TransmissionTorrent } from '@/types';
import { ensureDownloadSearchJob, getDownloadSearchJobs, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';
import { rememberDownloadTransfer } from '@/lib/db/download-transfers';

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
  body: 'Your media is ready in the library.',
};

let isRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function checkDownloads(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    let monitored = await getActiveMonitoredDownloads();

    const radarr = createRadarrClient();
    const sonarr = createSonarrClient();
    const transmission = createTransmissionClient();

    const [radarrQueue, sonarrQueue, transmissionTorrents] = await Promise.all([
      radarr
        ? radarr.getQueue(false).then((q) => q.records).catch((e) => { console.error('[watcher] radarr queue error:', e.message); return [] as RadarrQueueItem[]; })
        : Promise.resolve([] as RadarrQueueItem[]),
      sonarr
        ? sonarr.getQueue().then((q) => q.records).catch((e) => { console.error('[watcher] sonarr queue error:', e.message); return [] as SonarrQueueItem[]; })
        : Promise.resolve([] as SonarrQueueItem[]),
      transmission
        ? transmission.getTorrents().catch((e) => { console.error('[watcher] transmission error:', e.message); return [] as TransmissionTorrent[]; })
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

    const audioPolicies = new Map([...getMovieAudioPolicies().values()].map((policy) => [policy.radarrMovieId, policy]));
    const audioJobs = new Map(getMovieAudioJobs().map((job) => [job.tmdbId, job]));
    const searchJobs = new Map(getDownloadSearchJobs().map((job) => [job.downloadId, job]));
    for (const download of monitored) {
      if (download.lastStatus === 'cancelling') continue;
      const queueItems =
        download.source === 'radarr'
          ? radarrQueue.filter((item) => item.movieId === download.mediaId)
          : sonarrQueue.filter((item) => item.seriesId === download.mediaId);
      for (const item of queueItems) {
        if (download.source === 'radarr' || download.source === 'sonarr') rememberDownloadTransfer(download.source, download.mediaId, item.downloadId);
      }

      // Find matched torrent for this download
      const matchedTorrent = queueItems
        .map((item) => item.downloadId ? torrentsByHash.get(item.downloadId.toLowerCase()) : undefined)
        .find((t) => t !== undefined) ?? null;

      // Update activity timestamps whenever the download is in the queue
      const now = Date.now();
      if (queueItems.length > 0) {
        const hasBytesActivity = (matchedTorrent?.rateDownload ?? 0) > 0;
        await updateDownloadActivity(download.id, hasBytesActivity);
        // Mirror the DB update in-memory so the stall check below uses current data
        download.lastActivityAt = now;
        if (hasBytesActivity) download.lastBytesAt = now;
      }

      let effectiveStatus = resolveStatus(queueItems, torrentsByHash);

      const audioPolicy = download.source === 'radarr' ? audioPolicies.get(download.mediaId) : undefined;
      const audioReady = audioPolicy ? audioJobs.get(audioPolicy.tmdbId)?.state === 'available' : undefined;
      const searchJob = searchJobs.get(download.id);
      let legacyReady = false;
      // Legacy movie tracking also needs a confirmed library file, never an empty queue alone.
      if (!audioPolicy && download.source === 'radarr' && radarr && queueItems.length === 0 && download.lastStatus !== null &&
          (!searchJob || searchJob.state === 'needs_review' && searchJob.submittedAt === null && download.userIds.length === 0)) {
        try {
          legacyReady = (await radarr.getMovie(download.mediaId)).hasFile === true;
        } catch { console.warn(`[watcher] library confirmation unavailable for movie ${download.mediaId}`); }
      }
      if (audioPolicy ? audioReady : searchJob?.state === 'complete' || legacyReady) {
        const requestLock = acquireMovieAudioLock(-(download.mediaId * 2 + (download.source === 'sonarr' ? 1 : 0)));
        if (!requestLock) continue;
        const audioLock = audioPolicy ? acquireMovieAudioLock(audioPolicy.tmdbId + 2) : null;
        if (audioPolicy && !audioLock) { releaseMovieAudioLock(requestLock); continue; }
        try {
          const fresh = await getLatestMonitoredDownloadBySourceMedia(download.source as 'radarr' | 'sonarr', download.mediaId);
          if (!fresh || fresh.completedAt !== null) continue;
          let currentSearch = getDownloadSearchJobs().find((job) => job.downloadId === download.id);
          if (!audioPolicy && [...getMovieAudioPolicies().values()].some((policy) => policy.radarrMovieId === download.mediaId)) continue;
          if (legacyReady && !audioPolicy && fresh.lastStatus === download.lastStatus && fresh.createdAt === download.createdAt &&
              (!currentSearch || currentSearch.state === 'needs_review' && currentSearch.submittedAt === null && download.userIds.length === 0)) {
            currentSearch = ensureDownloadSearchJob(download.id, 'radarr');
            updateDownloadSearchJob(download.id, { state: 'complete' });
            currentSearch = { ...currentSearch, state: 'complete' };
          }
          if (!audioPolicy && currentSearch?.state !== 'complete') continue;
          // A new language request may have arrived since the initial status read.
          if (audioPolicy && getMovieAudioJobs().find((job) => job.tmdbId === audioPolicy.tmdbId)?.state !== 'available') continue;
          await Promise.all(
            download.userIds.map((userId) =>
              sendToUser(userId, {
                title: READY_NOTIFICATION.title(download.title),
                body: audioPolicy ? 'All requested audio languages are available.' : READY_NOTIFICATION.body,
                tag: `download-complete-${download.id}`,
              })
            )
          );
          await markDownloadCompleted(download.id);
        } finally {
          if (audioLock) releaseMovieAudioLock(audioLock);
          releaseMovieAudioLock(requestLock);
        }
        continue;
      }

      // Timestamp-based stall check (independent of Transmission's own stall detection)
      if (effectiveStatus !== null) {
        const isActiveDownload = effectiveStatus === 'downloading' || effectiveStatus === 'queued';
        const hasRemainingWork = matchedTorrent ? matchedTorrent.leftUntilDone > 0 : true;

        if (isActiveDownload && hasRemainingWork) {
          // Prefer Transmission's activityDate (seconds) when available — it's updated at
          // torrent-client granularity, not just on watcher poll cycles.
          const transmissionActivityMs =
            matchedTorrent?.activityDate && matchedTorrent.activityDate > 0
              ? matchedTorrent.activityDate * 1000
              : null;
          const effectiveLastBytesAt =
            transmissionActivityMs !== null && download.lastBytesAt !== null
              ? Math.max(download.lastBytesAt, transmissionActivityMs)
              : transmissionActivityMs ?? download.lastBytesAt;

          if (effectiveLastBytesAt !== null) {
            if (now - effectiveLastBytesAt > BYTES_STALL_MS) effectiveStatus = 'stalled';
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
  // Run immediately on startup to sync existing downloads
  checkDownloads();
  intervalId = setInterval(checkDownloads, 30_000);
  console.log('[watcher] started (initial sync triggered)');
}
