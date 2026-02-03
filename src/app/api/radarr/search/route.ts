import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { isAxiosError } from 'axios';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';

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
    const results = await radarr.searchMovies(query);
    const existingMovies = await radarr.getMovies();
    const existingTmdbIds = new Set(existingMovies.map((m) => m.tmdbId));

    const enrichedResults = results.map((movie) => ({
      ...movie,
      inLibrary: existingTmdbIds.has(movie.tmdbId),
      libraryId: existingMovies.find((m) => m.tmdbId === movie.tmdbId)?.id,
    }));

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
    const { title, tmdbId, year, qualityProfileId, rootFolderPath, searchForMovie } = body;

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
      searchForMovie: searchForMovie ?? true,
    });

    return NextResponse.json(movie, { status: 201 });
  } catch (error) {
    console.error('Radarr add movie error:', error);
    return NextResponse.json({ error: 'Failed to add movie' }, { status: 500 });
  }
}
