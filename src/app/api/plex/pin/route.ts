import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { PlexAuthClient } from '@/lib/api/plex';

function getConfigurationError(): string | null {
  const missing = ['PLEX_CLIENT_ID', 'PLEX_SERVER_MACHINE_IDENTIFIER', 'NEXTAUTH_SECRET']
    .filter((name) => !process.env[name]?.trim());
  return missing.length ? `Plex login is not configured. Missing: ${missing.join(', ')}.` : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const configurationError = getConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503 });
  }
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const pinId = searchParams.get('pinId');

  if (!pinId || !/^\d+$/.test(pinId) || !Number.isSafeInteger(Number(pinId)) || Number(pinId) <= 0) {
    return NextResponse.json({ error: 'A valid PIN ID is required' }, { status: 400 });
  }

  const configurationError = getConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503 });
  }

  try {
    const plexClient = new PlexAuthClient(process.env.PLEX_CLIENT_ID);
    const pin = await plexClient.checkPin(parseInt(pinId, 10));

    return NextResponse.json({
      completed: !!pin.authToken,
      authToken: pin.authToken,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return NextResponse.json(
        { error: 'This Plex sign-in request expired or is no longer valid. Please sign in again.' },
        { status: 410 }
      );
    }
    console.error('Plex PIN check error:', error);
    return NextResponse.json({ error: 'Failed to check PIN status' }, { status: 500 });
  }
}
