import { after, NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createTransmissionClient } from '@/lib/api/transmission';
import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { getCachedTransmissionState, invalidateQueueCache } from '@/lib/queue-cache';
import { getTorrentIndexerMetadata, normalizeTorrentHash } from '@/lib/db/torrent-indexers';
import { acquireMovieAudioLock, getMovieAudioJobs, releaseMovieAudioLock } from '@/lib/db/movie-audio';
import { DownloadRetryError, downloadRetryErrorResponse } from '@/lib/download-retry';
import { readAudioLanguages } from '@/lib/audio-languages';
import { recoverTorrentIndexers } from '@/lib/torrent-indexer-history';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Error' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Error' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const hash = body && typeof body === 'object' && 'hash' in body && typeof body.hash === 'string'
    ? normalizeTorrentHash(body.hash) : undefined;
  if (!hash) return NextResponse.json({ error: 'Error' }, { status: 400 });
  const locks: string[] = [];
  try {
    const transmission = createTransmissionClient();
    if (!transmission) throw new DownloadRetryError('Transmission is not configured.', 503);
    // Prevent either worker from claiming an unmatched torrent during cancellation.
    for (const id of [0, -1]) {
      const lock = acquireMovieAudioLock(id);
      if (!lock) throw new DownloadRetryError('A download worker is processing requests. Retry shortly.');
      locks.push(lock);
    }
    if (getMovieAudioJobs().some((job) => normalizeTorrentHash(job.donorHash ?? undefined) === hash &&
        !['available', 'cancelled'].includes(job.state))) {
      throw new DownloadRetryError('This torrent belongs to an audio request. Use its request controls.');
    }
    const radarr = createRadarrClient();
    const sonarr = createSonarrClient();
    // A failed ownership check must not be treated as an empty queue.
    const queues = await Promise.all([radarr?.getQueue(false), sonarr?.getQueue(false, false)]);
    if (queues.some((queue) => queue && queue.records.length >= 1000)) {
      throw new DownloadRetryError('The service queue is too large to establish torrent ownership safely.', 503);
    }
    if (queues.some((queue) => queue?.records.some((item) => normalizeTorrentHash(item.downloadId) === hash))) {
      throw new DownloadRetryError('This torrent belongs to a download request. Refresh and use its request controls.');
    }
    const torrents = await transmission.getTorrents();
    if (torrents.some((torrent) => normalizeTorrentHash(torrent.hashString) === hash)) {
      // Hashes survive numeric ID reuse. Keep downloaded and seeding files intact.
      await transmission.pauseTorrent(hash);
      await transmission.removeTorrent(hash, false);
    }
    return NextResponse.json({ state: 'cancelled' });
  } catch (cause) { return downloadRetryErrorResponse('cancel unmatched Transmission torrent', cause); }
  finally {
    invalidateQueueCache(['transmission-state']);
    for (const lock of locks) releaseMovieAudioLock(lock);
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const transmission = createTransmissionClient();
  if (!transmission) {
    return NextResponse.json({ error: 'Transmission not configured' }, { status: 503 });
  }

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const { torrents, stats } = await getCachedTransmissionState(transmission, { forceRefresh });
    const hashes = torrents.map((torrent) => torrent.hashString);
    const indexers = getTorrentIndexerMetadata(hashes);
    if (session.user.role === 'admin' && request.nextUrl.searchParams.get('filter') === 'all') {
      after(() => recoverTorrentIndexers(hashes).catch(() => {
        console.warn('[indexers] Background history recovery failed.');
      }));
    }

    // Note: filtering by user happens at Radarr/Sonarr level, not here.
    // Transmission data is used to enrich queue items matched by hash.
    const torrentsWithProblems = torrents.map((torrent) => {
      const problemCheck = transmission.isProblematic(torrent);
      return {
        ...torrent,
        errorString: session.user.role === 'admin' ? torrent.errorString : torrent.errorString ? 'Error' : '',
        trackerStats: session.user.role === 'admin' ? torrent.trackerStats : torrent.trackerStats?.map((tracker) => ({ ...tracker,
          lastAnnounceResult: tracker.lastAnnounceResult ? tracker.lastAnnounceSucceeded ? 'Success' : 'Error' : '',
          lastScrapeResult: tracker.lastScrapeResult ? tracker.lastScrapeSucceeded ? 'Success' : 'Error' : '',
        })),
        indexer: indexers.get(torrent.hashString.toLowerCase())?.indexer,
        estimatedAudioLanguages: readAudioLanguages(indexers.get(torrent.hashString.toLowerCase())?.audioLanguages),
        statusString: transmission.getStatusString(torrent.status),
        isProblematic: problemCheck.isProblematic,
        problemReason: session.user.role === 'admin' ? problemCheck.reason : problemCheck.reason ? 'Error' : undefined,
      };
    });

    return NextResponse.json({
      torrents: torrentsWithProblems,
      stats,
    });
  } catch (error) {
    console.error('Transmission error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get torrents';
    return NextResponse.json({ error: session.user.role === 'admin' ? message : 'Error' }, { status: 500 });
  }
}
