import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPlexAdminClient } from '@/lib/api/plex';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const client = getPlexAdminClient();
    const libraries = await client.getLibrarySections();
    return NextResponse.json({ libraries });
  } catch (error) {
    console.error('Failed to fetch Plex libraries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch libraries from Plex' },
      { status: 500 }
    );
  }
}
