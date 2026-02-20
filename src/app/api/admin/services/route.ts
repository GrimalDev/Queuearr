import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    Radarr: process.env.RADARR_URL ?? null,
    Sonarr: process.env.SONARR_URL ?? null,
    Transmission: process.env.TRANSMISSION_URL ?? null,
  });
}
