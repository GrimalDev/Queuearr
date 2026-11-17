import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';
import { getMonitoredDownloadBySourceMedia } from '@/lib/db/monitored-downloads';
import { getDownloadSearchJobs } from '@/lib/db/download-search-jobs';
import { activeSonarrSearchScopes, withSonarrEpisodeActivity } from '@/lib/sonarr-search-scopes';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isSafeInteger(seriesId) || seriesId <= 0) {
    return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
  }

  try {
    const [episodes, queue, download] = await Promise.all([
      sonarr.getEpisodes(seriesId), sonarr.getQueue(), getMonitoredDownloadBySourceMedia('sonarr', seriesId),
    ]);
    const active = download?.completedAt === null && !['cancelled', 'cancelling'].includes(download.lastStatus ?? '');
    const job = active ? getDownloadSearchJobs().find((item) => item.downloadId === download.id) : undefined;
    return NextResponse.json(withSonarrEpisodeActivity(episodes, queue.records.filter((item) => item.seriesId === seriesId), activeSonarrSearchScopes(job)),
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Sonarr episodes error:', error);
    return NextResponse.json({ error: 'Failed to fetch episodes' }, { status: 500 });
  }
}
