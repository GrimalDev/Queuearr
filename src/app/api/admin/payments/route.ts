import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPaymentSettings, savePaymentSettings } from '@/lib/db/payments';
import { parsePaymentSettings } from '@/lib/payments';

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  try {
    return NextResponse.json(await getPaymentSettings(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load payment settings:', error);
    return NextResponse.json({ error: 'Could not load payment settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const settings = parsePaymentSettings(await request.json().catch(() => null));
  if (!settings) {
    return NextResponse.json({ error: 'Enter a valid HTTPS payment URL and enable or disable reminders.' }, { status: 400 });
  }
  try {
    await savePaymentSettings(settings);
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to save payment settings:', error);
    return NextResponse.json({ error: 'Could not save payment settings' }, { status: 500 });
  }
}
