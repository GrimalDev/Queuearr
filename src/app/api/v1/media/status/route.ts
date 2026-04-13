import { NextRequest, NextResponse } from 'next/server';
import { getUserByApiToken } from '@/lib/db/users';
import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import { getMonitoredDownloadBySourceMedia } from '@/lib/db/monitored-downloads';

interface MovieStatusResponse {
  type: 'movie';
  title: string;
  inLibrary: boolean;
  hasFile: boolean;
  isDownloading: boolean;
  grabbed: boolean;
}

interface SeriesStatusResponse {
  type: 'series';
  title: string;
  inLibrary: boolean;
  hasFile: boolean;
  isDownloading: boolean;
  grabbed: boolean;
}

function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return request.nextUrl.searchParams.get('token');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = extractToken(request);

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 401 });
  }

  const user = await getUserByApiToken(token);
  if (!user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const tmdbIdParam = searchParams.get('tmdbId');
  const tvdbIdParam = searchParams.get('tvdbId');

  if (!tmdbIdParam && !tvdbIdParam) {
    return NextResponse.json(
      { error: 'Provide either tmdbId or tvdbId query parameter' },
      { status: 400 }
    );
  }

  if (tmdbIdParam) {
    return handleMovieStatus(tmdbIdParam);
  }

  return handleSeriesStatus(tvdbIdParam!);
}

async function handleMovieStatus(tmdbIdParam: string): Promise<NextResponse> {
  const tmdbId = parseInt(tmdbIdParam, 10);
  if (isNaN(tmdbId)) {
    return NextResponse.json({ error: 'Invalid tmdbId' }, { status: 400 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  try {
    const movies = await radarr.getMovies();
    const movie = movies.find((m) => m.tmdbId === tmdbId);

    if (!movie || movie.id === undefined) {
      const response: MovieStatusResponse = {
        type: 'movie',
        title: '',
        inLibrary: false,
        hasFile: false,
        isDownloading: false,
        grabbed: false,
      };
      return NextResponse.json(response);
    }

    const hasFile = movie.hasFile ?? false;

    const [queueResult, monitoredDownload] = await Promise.all([
      radarr.getQueue(true),
      getMonitoredDownloadBySourceMedia('radarr', movie.id),
    ]);

    const isInQueue = queueResult.records.some((item) => item.movieId === movie.id);
    const isDownloading = isInQueue || monitoredDownload !== undefined;

    const response: MovieStatusResponse = {
      type: 'movie',
      title: movie.title,
      inLibrary: true,
      hasFile,
      isDownloading,
      grabbed: hasFile || isDownloading,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching movie status from Radarr:', error);
    return NextResponse.json({ error: 'Failed to fetch movie status' }, { status: 502 });
  }
}

async function handleSeriesStatus(tvdbIdParam: string): Promise<NextResponse> {
  const tvdbId = parseInt(tvdbIdParam, 10);
  if (isNaN(tvdbId)) {
    return NextResponse.json({ error: 'Invalid tvdbId' }, { status: 400 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  try {
    const allSeries = await sonarr.getSeries();
    const series = allSeries.find((s) => s.tvdbId === tvdbId);

    if (!series || series.id === undefined) {
      const response: SeriesStatusResponse = {
        type: 'series',
        title: '',
        inLibrary: false,
        hasFile: false,
        isDownloading: false,
        grabbed: false,
      };
      return NextResponse.json(response);
    }

    const [episodes, queueResult, monitoredDownload] = await Promise.all([
      sonarr.getEpisodes(series.id),
      sonarr.getQueue(true, false),
      getMonitoredDownloadBySourceMedia('sonarr', series.id),
    ]);

    const hasFile = episodes.some((ep) => ep.hasFile);
    const isInQueue = queueResult.records.some((item) => item.seriesId === series.id);
    const isDownloading = isInQueue || monitoredDownload !== undefined;

    const response: SeriesStatusResponse = {
      type: 'series',
      title: series.title,
      inLibrary: true,
      hasFile,
      isDownloading,
      grabbed: hasFile || isDownloading,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching series status from Sonarr:', error);
    return NextResponse.json({ error: 'Failed to fetch series status' }, { status: 502 });
  }
}
