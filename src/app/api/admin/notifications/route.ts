import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastNotification, isVapidConfigured } from '@/lib/push';
import { addNotification, getNotifications } from '@/lib/db/notifications';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 1000;
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

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (!isVapidConfigured()) {
    return NextResponse.json({ error: 'Push notifications not configured' }, { status: 503 });
  }

  try {
    const { title, body, icon, url, tag } = await request.json();

    if (typeof title !== 'string' || !title || title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ error: 'Invalid or missing title' }, { status: 400 });
    }
    if (typeof body !== 'string' || !body || body.length > MAX_BODY_LENGTH) {
      return NextResponse.json({ error: 'Invalid or missing body' }, { status: 400 });
    }
    // Only allow same-origin relative URLs
    if (url && (typeof url !== 'string' || !url.startsWith('/'))) {
      return NextResponse.json({ error: 'URL must be a relative path' }, { status: 400 });
    }

    const payload = { title, body, icon, url, tag };

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
