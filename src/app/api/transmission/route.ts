import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createTransmissionClient } from '@/lib/api/transmission';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const transmission = createTransmissionClient();
  if (!transmission) {
    return NextResponse.json({ error: 'Transmission not configured' }, { status: 503 });
  }

  try {
    const [torrents, stats] = await Promise.all([
      transmission.getTorrents(),
      transmission.getSessionStats(),
    ]);

    const queueSettings = {
      downloadQueueEnabled: stats.downloadQueueEnabled,
      downloadQueueSize: stats.downloadQueueSize,
    };

    const torrentsWithProblems = torrents.map((torrent) => {
      const problemCheck = transmission.isProblematic(torrent, queueSettings);
      return {
        ...torrent,
        statusString: transmission.getStatusString(torrent.status),
        isProblematic: problemCheck.isProblematic,
        problemReason: problemCheck.reason,
      };
    });

    return NextResponse.json({
      torrents: torrentsWithProblems,
      stats,
    });
  } catch (error) {
    console.error('Transmission error:', error);
    return NextResponse.json({ error: 'Failed to get torrents' }, { status: 500 });
  }
}
