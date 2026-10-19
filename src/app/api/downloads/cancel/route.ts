import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';
import { authOptions } from '@/lib/auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { createTransmissionClient } from '@/lib/api/transmission';
import { db } from '@/lib/db';
import { monitoredDownloads } from '@/lib/db/schema';
import { acquireMovieAudioLock, getMovieAudioJobs, getMovieAudioPolicies, releaseMovieAudioLock, updateMovieAudioJob } from '@/lib/db/movie-audio';
import { getLatestMonitoredDownloadBySourceMedia, isUserWatching } from '@/lib/db/monitored-downloads';
import { DownloadRetryError, downloadRetryErrorResponse } from '@/lib/download-retry';
import { invalidateQueueCache } from '@/lib/queue-cache';
import { ensureDownloadSearchJob, getDownloadSearchJobs, updateDownloadSearchJob } from '@/lib/db/download-search-jobs';
import { isImportInProgress } from '@/lib/queue-retry-safety';
import { excludeCurrentAudioDonor } from '@/lib/movie-audio-attempts';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Error' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('source' in body) || !('mediaId' in body) ||
      (body.source !== 'radarr' && body.source !== 'sonarr') || typeof body.mediaId !== 'number' ||
      !Number.isSafeInteger(body.mediaId) || body.mediaId <= 0 || body.mediaId > 2_147_483_647 ||
      ('activeDownload' in body && typeof body.activeDownload !== 'boolean')) {
    return NextResponse.json({ error: 'Error' }, { status: 400 });
  }
  const { source, mediaId } = body;
  const activeDownload = 'activeDownload' in body && body.activeDownload === true;
  let requestLock: string | null = null;
  let movieLock: string | null = null;
  try {
    // Share the retry lock so cancellation cannot race a manual search/retry.
    requestLock = acquireMovieAudioLock(-(mediaId * 2 + (source === 'sonarr' ? 1 : 0)));
    if (!requestLock) throw new DownloadRetryError('A request change is already in progress.');
    const download = await getLatestMonitoredDownloadBySourceMedia(source, mediaId);
    if (!download) throw new DownloadRetryError('The search request no longer exists.', 404);
    if (session.user.role !== 'admin' && !await isUserWatching(download.id, session.user.id)) {
      throw new DownloadRetryError('Requester or administrator access required.', 403);
    }
    const policy = source === 'radarr' ? [...getMovieAudioPolicies().values()].find((item) => item.radarrMovieId === mediaId) : undefined;
    if (policy) {
      movieLock = acquireMovieAudioLock(policy.tmdbId + 2);
      if (!movieLock) throw new DownloadRetryError('This movie is being processed.');
    }
    const job = policy ? getMovieAudioJobs().find((item) => item.tmdbId === policy.tmdbId) : undefined;
    const rejectedDonors = job ? excludeCurrentAudioDonor(job) : undefined;
    let searchJob = getDownloadSearchJobs().find((item) => item.downloadId === download.id);
    if (!activeDownload && searchJob?.state === 'grab_pending') throw new DownloadRetryError('A release submission is already pending.');
    if (job ? (!activeDownload && job.donorHash) || job.outputPath || job.restoreMonitored !== null || job.replaceDonor ||
        !['pending', 'downloading', 'regrabbing', 'waiting_for_configuration', 'search_failed', 'in_cinemas',
          ...(activeDownload ? ['grab_pending', 'needs_review', 'cancelling'] : [])].includes(job.state)
      : download.completedAt !== null || (!activeDownload && !searchJob && download.lastStatus !== null)) {
      throw new DownloadRetryError('Only a pending search can be cancelled.');
    }
    const client = source === 'radarr' ? createRadarrClient() : createSonarrClient();
    if (!client) throw new DownloadRetryError('The download service is not configured.', 503);
    const queue = await client.getQueue();
    const matching = queue.records.filter((item) => ('movieId' in item ? item.movieId : 'seriesId' in item ? item.seriesId : undefined) === mediaId);
    if (!activeDownload && matching.length) {
      throw new DownloadRetryError('The download has started. Refresh and use its download controls.');
    }
    if (activeDownload) {
      if ((searchJob?.state === 'grab_pending' || job?.state === 'grab_pending') && !matching.length && !job?.donorHash) {
        throw new DownloadRetryError('An uncertain release submission needs review before cancellation.');
      }
      const transmission = job?.donorHash ? createTransmissionClient() : null;
      if (job?.donorHash) {
        if (!transmission || !job.donorLanguageId) throw new DownloadRetryError('The audio download cannot be identified safely.');
        const donor = (await transmission.getAudioDonors()).find((torrent) => torrent.hashString.toLowerCase() === job.donorHash!.toLowerCase());
        if (donor ? donor.labels?.length !== 1 || donor.labels[0] !== `queuearr-audio-${job.tmdbId}-${job.donorLanguageId}` ||
            donor.downloadDir !== `/data/queuearr-audio/${job.tmdbId}-${job.donorLanguageId}` : job.state !== 'cancelling') {
          throw new DownloadRetryError('The donor is no longer isolated. Its files and settings were left unchanged.');
        }
      } else if (matching.some(isImportInProgress)) throw new DownloadRetryError('Import is in progress.');
      if (!job && !searchJob) searchJob = ensureDownloadSearchJob(download.id, source);
      // Reserve cancellation before external effects so a lost response cannot restart the job.
      db.transaction(() => {
        db.update(monitoredDownloads).set({ lastStatus: 'cancelling' }).where(eq(monitoredDownloads.id, download.id)).run();
        if (job) updateMovieAudioJob(job.tmdbId, { state: 'cancelling', detail: 'Cancelling download.', rejectedDonors });
        if (searchJob) updateDownloadSearchJob(download.id, { state: 'cancelling' });
      });
      if (job?.donorHash && transmission) {
        await transmission.pauseTorrent(job.donorHash);
        await transmission.removeTorrent(job.donorHash, false);
      } else if (matching.length) await client.deleteQueueItemBulk(matching.map((item) => item.id), { blocklist: false, skipRedownload: true });
    }
    db.transaction(() => {
      db.update(monitoredDownloads).set({ completedAt: Date.now(), lastStatus: 'cancelled' })
        .where(eq(monitoredDownloads.id, download.id)).run();
      if (job) updateMovieAudioJob(job.tmdbId, { state: 'cancelled', detail: activeDownload ? 'Download cancelled.' : 'Search cancelled.', nextAttemptAt: 0,
        regrabFileId: null, regrabRequestedAt: null, donorHash: null, donorLanguageId: null, donorIndexer: null,
        donorReleaseKey: null, donorMetadata: null, estimatedLanguages: '[]', rejectedDonors, replaceDonor: false });
      if (searchJob) updateDownloadSearchJob(download.id, { state: 'cancelled' });
    });
    invalidateQueueCache([source === 'radarr' ? 'radarr-queue' : 'sonarr-queue', 'transmission-state']);
    return NextResponse.json({ state: 'cancelled' });
  } catch (cause) { return downloadRetryErrorResponse(`${source} ${mediaId} cancel search`, cause); }
  finally {
    if (movieLock) releaseMovieAudioLock(movieLock);
    if (requestLock) releaseMovieAudioLock(requestLock);
  }
}
