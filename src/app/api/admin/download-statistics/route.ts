import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserDownloadStatistics } from '@/lib/db/download-requests';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const start = request.nextUrl.searchParams.get('start');
  const end = request.nextUrl.searchParams.get('end');
  const validDate = (value: string | null): value is string => !!value &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!validDate(start) || !validDate(end) || start >= end) {
    return NextResponse.json({ error: 'Choose a valid date range.' }, { status: 400 });
  }
  try {
    const users = getUserDownloadStatistics(Date.parse(start), Date.parse(end));
    return NextResponse.json({ start, end, users, totalDownloads: users.reduce((sum, user) => sum + user.downloads, 0) },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[downloads] Could not load per-user statistics.');
    return NextResponse.json({ error: 'Error' }, { status: 500 });
  }
}
