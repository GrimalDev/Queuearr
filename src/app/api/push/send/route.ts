import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendToUser, isVapidConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 1000;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Users can only send push notifications to their own devices
    const result = await sendToUser(session.user.id, payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Push send error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
