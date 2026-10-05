import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastNotification, isVapidConfigured } from '@/lib/push';
import { addNotification, getNotifications } from '@/lib/db/notifications';
import { parseNotificationContent } from '@/lib/notification-content';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 20;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)));

  const result = await getNotifications({ page, limit, includeDeleted: false });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (!isVapidConfigured()) {
    return NextResponse.json({ error: 'Push notifications not configured' }, { status: 503 });
  }

  try {
    const value: unknown = await request.json().catch(() => null);
    const content = parseNotificationContent(value);
    if (!content) {
      return NextResponse.json({ error: 'Invalid title, message, or relative URL' }, { status: 400 });
    }
    const { title, body, url } = content;
    const { icon, tag } = value as Record<string, unknown>;
    if ((icon !== undefined && icon !== null && typeof icon !== 'string') ||
        (tag !== undefined && tag !== null && typeof tag !== 'string')) {
      return NextResponse.json({ error: 'Invalid icon or tag' }, { status: 400 });
    }

    const payload = { title, body, icon: icon || undefined, url: url || undefined, tag: tag || undefined };

    await addNotification({
      title,
      body,
      url: url || null,
      icon: icon || null,
      tag: tag || null,
      sentBy: session.user.id,
    });

    // Broadcast to all users
    const result = await broadcastNotification(payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Broadcast notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
