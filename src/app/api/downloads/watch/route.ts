import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getMonitoredDownloadBySourceMedia,
  getActiveMonitoredDownloads,
  addUserToDownload,
  removeUserFromDownload,
} from '@/lib/db/monitored-downloads';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const downloads = await getActiveMonitoredDownloads();
  return NextResponse.json(downloads);
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
