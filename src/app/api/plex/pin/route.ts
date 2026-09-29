import { NextRequest, NextResponse } from 'next/server';
import { PlexAuthClient } from '@/lib/api/plex';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forwardUrl: string = body.forwardUrl ?? '';

    const plexClient = new PlexAuthClient(process.env.PLEX_CLIENT_ID);
    const pin = await plexClient.createPin();
    const authUrl = plexClient.getAuthUrl(pin, forwardUrl);

    return NextResponse.json({ pin, authUrl });
  } catch (error) {
    console.error('Plex PIN creation error:', error);
    return NextResponse.json({ error: 'Failed to create Plex PIN' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pinId = searchParams.get('pinId');

  if (!pinId) {
    return NextResponse.json({ error: 'PIN ID is required' }, { status: 400 });
  }

  try {
    const plexClient = new PlexAuthClient(process.env.PLEX_CLIENT_ID);
    const pin = await plexClient.checkPin(parseInt(pinId, 10));

    return NextResponse.json({
      completed: !!pin.authToken,
      authToken: pin.authToken,
    });
  } catch (error) {
    console.error('Plex PIN check error:', error);
    return NextResponse.json({ error: 'Failed to check PIN status' }, { status: 500 });
  }
}
