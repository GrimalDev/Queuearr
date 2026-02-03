import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createRadarrClient } from '@/lib/api/radarr';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const radarr = createRadarrClient();
  if (!radarr) {
    return NextResponse.json({ error: 'Radarr not configured' }, { status: 503 });
  }

  try {
    const queue = await radarr.getQueue(true);
    return NextResponse.json(queue.records);
  } catch (error) {
    console.error('Radarr queue error:', error);
    return NextResponse.json({ error: 'Failed to get queue' }, { status: 500 });
  }
}
