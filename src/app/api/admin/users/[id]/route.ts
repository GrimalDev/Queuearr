import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setUserRole, setUserActive, deleteUser } from '@/lib/db/users';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json() as { role?: string; active?: boolean };

  if (body.role !== undefined) {
    if (!['user', 'admin'].includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (id === session.user.id && body.role !== 'admin') {
      return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 });
    }
    await setUserRole(id, body.role);
  }

  if (body.active !== undefined) {
    if (id === session.user.id && !body.active) {
      return NextResponse.json({ error: 'Cannot deactivate yourself' }, { status: 400 });
    }
    await setUserActive(id, body.active);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;

  if (id === session.user.id) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  await deleteUser(id);
  return NextResponse.json({ success: true });
}
