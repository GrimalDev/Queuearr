import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createTransmissionClient } from '@/lib/api/transmission';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const transmission = createTransmissionClient();
  if (!transmission) {
    return NextResponse.json({ error: 'Transmission not configured' }, { status: 503 });
  }

  try {
    const { id } = (await request.json()) as { id?: number | string };
    if (id === undefined || id === null || id === '') {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    await transmission.queueTorrentTop(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Transmission queue move error:', error);
    const message = error instanceof Error ? error.message : 'Failed to move torrent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
