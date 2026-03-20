import { NextResponse } from 'next/server';
import { getActiveNotifications } from '@/lib/db/notifications';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const notifications = await getActiveNotifications();
    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
