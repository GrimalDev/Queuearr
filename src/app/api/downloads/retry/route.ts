import { retryDownloadSearch } from '@/lib/download-retry-actions';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { downloadRetryErrorResponse } from '@/lib/download-retry';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Error' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('source' in body) || !('mediaId' in body) ||
      (body.source !== 'radarr' && body.source !== 'sonarr') || typeof body.mediaId !== 'number' ||
      !Number.isSafeInteger(body.mediaId) || body.mediaId <= 0 || body.mediaId > 2_147_483_647) {
    return NextResponse.json({ error: 'Error' }, { status: 400 });
  }
  const { source, mediaId } = body;
  try {
    const retryAvailableAt = await retryDownloadSearch(source, mediaId, session.user);
    return NextResponse.json({ state: 'pending', retryAvailableAt }, { status: 202 });
  } catch (cause) { return downloadRetryErrorResponse(`${source} ${mediaId} search`, cause); }
}
