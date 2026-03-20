import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markAllNotificationsAsSeen } from '@/lib/db/notifications';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await markAllNotificationsAsSeen(session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Mark notifications as seen error:', error);
    return NextResponse.json({ error: 'Failed to mark notifications as seen' }, { status: 500 });
  }
}
