import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPaymentReminderStatus, recordPaymentChoice } from '@/lib/db/payments';
import { isFakePaywallEnabled } from '@/lib/payments';

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const status = await getPaymentReminderStatus(session.user.id);
    if (!status) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load payment status:', error);
    return NextResponse.json({ error: 'Could not load payment status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isFakePaywallEnabled()) {
    return NextResponse.json({ error: 'Voluntary payments are disabled' }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const action = body && typeof body === 'object' && 'action' in body ? body.action : null;
  if (action !== 'confirm' && action !== 'later') {
    return NextResponse.json({ error: 'Choose confirm or later' }, { status: 400 });
  }
  try {
    const status = recordPaymentChoice(session.user.id, action);
    if (!status) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to record payment choice:', error);
    return NextResponse.json({ error: 'Could not save your choice. Please try again.' }, { status: 500 });
  }
}
