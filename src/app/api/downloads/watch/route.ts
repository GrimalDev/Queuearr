import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDownloadRetryTimes } from '@/lib/download-retry';
import { getDownloadSearchJobs } from '@/lib/db/download-search-jobs';
import { getMovieAudioJobs, getMovieAudioPolicies } from '@/lib/db/movie-audio';
import { getDownloadTransferHashes } from '@/lib/db/download-transfers';
import { readAudioLanguages } from '@/lib/audio-languages';
import { getTorrentIndexerMetadata } from '@/lib/db/torrent-indexers';
import {
  getMonitoredDownloadBySourceMedia,
  getActiveMonitoredDownloads,
  getActiveMonitoredDownloadsForUser,
  getQueueMonitoredDownloads,
  addUserToDownload,
  removeUserFromDownload,
} from '@/lib/db/monitored-downloads';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const filter = request.nextUrl.searchParams.get('filter') ?? 'mine';
  const downloads = request.nextUrl.searchParams.get('includeReady') === '1'
    ? await getQueueMonitoredDownloads(filter === 'all' ? undefined : session.user.id)
    : filter === 'all'
    ? await getActiveMonitoredDownloads()
    : await getActiveMonitoredDownloadsForUser(session.user.id);
  const retryTimes = getDownloadRetryTimes();
  const searchJobs = new Map(getDownloadSearchJobs().map((job) => [job.downloadId, job]));
  const audioPolicies = new Map([...getMovieAudioPolicies().values()].map((policy) => [policy.radarrMovieId, policy]));
  const audioJobs = new Map(getMovieAudioJobs().map((job) => [job.tmdbId, job]));
  const hashes = getDownloadTransferHashes(downloads.map((download) => download.id));
  const transferMetadata = getTorrentIndexerMetadata([...hashes.values()].flat());
  return NextResponse.json(downloads.map((download) => {
    const policy = download.source === 'radarr' ? audioPolicies.get(download.mediaId) : undefined;
    const audio = policy ? audioJobs.get(policy.tmdbId) : undefined;
    const ready = policy ? audio?.state === 'available' : searchJobs.get(download.id)?.state === 'complete';
    const savedTransfer = [...(hashes.get(download.id) ?? [])].reverse().map((hash) => transferMetadata.get(hash));
    const estimated = readAudioLanguages(audio?.estimatedLanguages ?? searchJobs.get(download.id)?.estimatedLanguages);
    return { ...download,
    libraryReady: ready, audioState: audio?.state, requestedAudioLanguages: policy?.requiredLanguages,
    estimatedAudioLanguages: estimated.length ? estimated : savedTransfer.map((transfer) => readAudioLanguages(transfer?.audioLanguages)).find((languages) => languages.length) ?? [],
    downloadHashes: hashes.get(download.id) ?? [],
    retryAvailableAt: retryTimes.get(`${download.source}:${download.mediaId}`),
    searchState: searchJobs.get(download.id)?.state,
    errorMessage: session.user.role === 'admin' ? audio?.detail : undefined,
    searchIndexer: audio?.donorIndexer ?? searchJobs.get(download.id)?.indexer ?? savedTransfer.find((transfer) => transfer?.indexer)?.indexer,
    retryRequiresReview: searchJobs.get(download.id)?.state === 'needs_review' && searchJobs.get(download.id)?.submittedAt !== null,
  }; }).filter((download) => download.completedAt == null || download.libraryReady));
}

async function parseBody(request: NextRequest): Promise<{ source?: string; mediaId?: number } | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await parseBody(request);
  if (!body || !body.source || !body.mediaId) {
    return NextResponse.json({ error: 'Missing required fields: source, mediaId' }, { status: 400 });
  }

  const { source, mediaId } = body;
  if (source !== 'radarr' && source !== 'sonarr') {
    return NextResponse.json({ error: 'source must be radarr or sonarr' }, { status: 400 });
  }

  const download = await getMonitoredDownloadBySourceMedia(source, mediaId);
  if (!download) {
    return NextResponse.json({ error: 'Not currently monitored' }, { status: 404 });
  }

  await addUserToDownload(download.id, session.user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await parseBody(request);
  if (!body || !body.source || !body.mediaId) {
    return NextResponse.json({ error: 'Missing required fields: source, mediaId' }, { status: 400 });
  }

  const { source, mediaId } = body;
  if (source !== 'radarr' && source !== 'sonarr') {
    return NextResponse.json({ error: 'source must be radarr or sonarr' }, { status: 400 });
  }

  const download = await getMonitoredDownloadBySourceMedia(source, mediaId);
  if (!download) {
    return NextResponse.json({ error: 'Not currently monitored' }, { status: 404 });
  }

  await removeUserFromDownload(download.id, session.user.id);
  return NextResponse.json({ ok: true });
}
