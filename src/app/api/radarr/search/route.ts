import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { isAxiosError } from 'axios';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';
import { getMovieAudioPolicies, getMovieAudioJobs } from '@/lib/db/movie-audio';
import { getAvailableAudio, getPublicMovieAudioDetail } from '@/lib/movie-audio-policy';
import { queueDownloadSearch } from '@/lib/db/download-search-jobs';
import { invalidateQueueCache } from '@/lib/queue-cache';
import {
  getActiveMediaIds,
  isUserWatching,
} from '@/lib/db/monitored-downloads';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    const [results, existingMovies, activeMediaIds, radarrQueue] = await Promise.all([
      radarr.searchMovies(query),
      radarr.getMovies(),
      getActiveMediaIds('radarr'),
      radarr.getQueue(false),
    ]);

    const audioPolicies = getMovieAudioPolicies();
    const audioJobs = new Map(getMovieAudioJobs().map((job) => [job.tmdbId, job]));
    const existingTmdbIds = new Set(existingMovies.map((m) => m.tmdbId));
    const queuedMovieIds = new Set(radarrQueue.records.map((item) => item.movieId).filter(Boolean));

    const enrichedResults = await Promise.all(
      results.map(async (movie) => {
        const libraryMovie = existingMovies.find((m) => m.tmdbId === movie.tmdbId);
        const libraryId = libraryMovie?.id;
        const monitoredId = libraryId !== undefined ? activeMediaIds.get(libraryId) : undefined;
        const isDownloading = monitoredId !== undefined && queuedMovieIds.has(libraryId!);
        const watching = monitoredId !== undefined
          ? await isUserWatching(monitoredId!, session.user.id)
          : false;

        return {
          ...movie,
          hasFile: libraryMovie?.hasFile ?? false,
          originalLanguage: libraryMovie?.originalLanguage ?? movie.originalLanguage,
          availableAudioLanguages: libraryMovie ? getAvailableAudio(libraryMovie) : [],
          requestedAudioLanguages: audioPolicies.get(movie.tmdbId)?.requiredLanguages ?? [],
          audioRequestState: audioJobs.get(movie.tmdbId)?.state,
          audioRequestDetail: getPublicMovieAudioDetail(audioJobs.get(movie.tmdbId)?.state, audioJobs.get(movie.tmdbId)?.detail),
          inLibrary: existingTmdbIds.has(movie.tmdbId),
          libraryId,
          isDownloading,
          monitoredId,
          isWatching: watching,
        };
      })
    );

    return NextResponse.json(enrichedResults);
  } catch (error) {
    if (isAxiosError(error) && error.code === 'ECONNABORTED') {
      return NextResponse.json(
        { error: 'Radarr search timed out. Please try a more specific search term.' },
        { status: 504 }
      );
    }
    console.error('Radarr search error:', error);
    return NextResponse.json({ error: 'Failed to search movies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { title, tmdbId, year, qualityProfileId, rootFolderPath } = body;

    if (!title || !tmdbId || !year) {
      return NextResponse.json(
        { error: 'Missing required fields: title, tmdbId, year' },
        { status: 400 }
      );
    }

    let qpId = qualityProfileId;
    let rfPath = rootFolderPath;

    if (!qpId || !rfPath) {
      const [profiles, folders] = await Promise.all([
        radarr.getQualityProfiles(),
        radarr.getRootFolders(),
      ]);
      if (!qpId && profiles.length > 0) qpId = profiles[0].id;
      if (!rfPath && folders.length > 0) rfPath = folders[0].path;
    }

    const movie = await radarr.addMovie({
      title,
      tmdbId,
      year,
      qualityProfileId: qpId,
      rootFolderPath: rfPath,
      searchForMovie: false,
    });

    if (movie.id) {
      queueDownloadSearch('radarr', movie.id, movie.title, session.user.id, { type: 'movie' });
    }
    invalidateQueueCache(['radarr-queue', 'transmission-state']);

    return NextResponse.json(movie, { status: 201 });
  } catch (error) {
    console.error('Radarr add movie error:', error);
    return NextResponse.json({ error: 'Failed to add movie' }, { status: 500 });
  }
}
