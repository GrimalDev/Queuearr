import { after, NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createTransmissionClient } from '@/lib/api/transmission';
import { authOptions } from '@/lib/auth';
import { getCachedTransmissionState } from '@/lib/queue-cache';
import { getTorrentIndexerMetadata } from '@/lib/db/torrent-indexers';
import { readAudioLanguages } from '@/lib/audio-languages';
import { recoverTorrentIndexers } from '@/lib/torrent-indexer-history';

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
        indexer: indexers.get(torrent.hashString.toLowerCase())?.indexer,
        estimatedAudioLanguages: readAudioLanguages(indexers.get(torrent.hashString.toLowerCase())?.audioLanguages),
        statusString: transmission.getStatusString(torrent.status),
        isProblematic: problemCheck.isProblematic,
        problemReason: problemCheck.reason,
      };
    });

    return NextResponse.json({
      torrents: torrentsWithProblems,
      stats,
    });
  } catch (error) {
    console.error('Transmission error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get torrents';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
