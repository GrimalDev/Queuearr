import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createSonarrClient } from '@/lib/api/sonarr';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  const sonarr = createSonarrClient();
  if (!sonarr) {
    return NextResponse.json({ error: 'Sonarr not configured' }, { status: 503 });
  }

  try {
    const queue = await sonarr.getQueue(true, true);
    return NextResponse.json(queue.records);
  } catch (error) {
    console.error('Sonarr queue error:', error);
    return NextResponse.json({ error: 'Failed to get queue' }, { status: 500 });
  }
}
