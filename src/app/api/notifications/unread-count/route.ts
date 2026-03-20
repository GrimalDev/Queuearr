import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUnreadNotificationsCount } from '@/lib/db/notifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const unreadCount = await getUnreadNotificationsCount(session.user.id);
    return NextResponse.json({ unreadCount });
  } catch (error) {
    console.error('Fetch unread notifications count error:', error);
    return NextResponse.json({ error: 'Failed to fetch unread notifications count' }, { status: 500 });
  }
}
