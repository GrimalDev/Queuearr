import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { isAxiosError } from 'axios';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    const results = await sonarr.searchSeries(query);
    const existingSeries = await sonarr.getSeries();
    const existingTvdbIds = new Set(existingSeries.map((s) => s.tvdbId));

    const enrichedResults = results.map((series) => ({
      ...series,
      inLibrary: existingTvdbIds.has(series.tvdbId),
      libraryId: existingSeries.find((s) => s.tvdbId === series.tvdbId)?.id,
    }));

    return NextResponse.json(enrichedResults);
  } catch (error) {
    if (isAxiosError(error) && error.code === 'ECONNABORTED') {
      return NextResponse.json(
        { error: 'Sonarr search timed out. Please try a more specific search term.' },
        { status: 504 }
      );
    }
    console.error('Sonarr search error:', error);
    return NextResponse.json({ error: 'Failed to search series' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const {
      title,
      tvdbId,
      qualityProfileId,
      languageProfileId,
      rootFolderPath,
      searchForMissingEpisodes,
    } = body;

    if (!title || !tvdbId) {
      return NextResponse.json(
        { error: 'Missing required fields: title, tvdbId' },
        { status: 400 }
      );
    }

    let qpId = qualityProfileId;
    let lpId = languageProfileId;
    let rfPath = rootFolderPath;

    if (!qpId || !lpId || !rfPath) {
      const [profiles, langProfiles, folders] = await Promise.all([
        sonarr.getQualityProfiles(),
        sonarr.getLanguageProfiles(),
        sonarr.getRootFolders(),
      ]);
      if (!qpId && profiles.length > 0) qpId = profiles[0].id;
      if (!lpId && langProfiles.length > 0) lpId = langProfiles[0].id;
      if (!rfPath && folders.length > 0) rfPath = folders[0].path;
    }

    const series = await sonarr.addSeries({
      title,
      tvdbId,
      qualityProfileId: qpId,
      languageProfileId: lpId,
      rootFolderPath: rfPath,
      searchForMissingEpisodes: searchForMissingEpisodes ?? true,
    });

    return NextResponse.json(series, { status: 201 });
  } catch (error) {
    console.error('Sonarr add series error:', error);
    return NextResponse.json({ error: 'Failed to add series' }, { status: 500 });
  }
}
