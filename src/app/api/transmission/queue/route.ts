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
    console.log('[queue-move-top] Received id:', id, 'type:', typeof id);
    if (id === undefined || id === null || id === '') {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    await transmission.queueTorrentTop(id);
    console.log('[queue-move-top] Result: success');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[queue-move-top] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to move torrent';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
