import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPlexAdminClient } from '@/lib/api/plex';
import {
  addInvitedUser,
  getInvitedUserByEmail,
  updateInvitedUser,
  getInvitedUsers,
  deleteInvitedUser,
} from '@/lib/db/users';

const DEFAULT_LIMIT = 10;

// GET /api/admin/invite - List invited users
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)));

  const result = await getInvitedUsers({ page, limit });
  return NextResponse.json(result);
}

// POST /api/admin/invite - Invite a new user
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, librarySectionIds } = body as {
      email: string;
      librarySectionIds?: number[];
    };

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Check if already invited
    const existing = await getInvitedUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'User already invited', existing },
        { status: 409 }
      );
    }

    // Send Plex invite
    const plexClient = getPlexAdminClient();
    const shareResult = await plexClient.shareLibrary(email, librarySectionIds || []);

    if (!shareResult.success) {
      return NextResponse.json(
        { error: shareResult.message || 'Failed to send Plex invite' },
        { status: 500 }
      );
    }

    // Add to whitelist
    const invitedUser = await addInvitedUser({
      email,
      librarySectionIds: librarySectionIds ? JSON.stringify(librarySectionIds) : null,
      invitedBy: session.user.id,
      plexInviteSent: true,
    });

    return NextResponse.json({
      success: true,
      invitedUser,
      plexAlreadyShared: shareResult.alreadyShared,
    });
  } catch (error) {
    console.error('Failed to invite user:', error);
    return NextResponse.json(
      { error: 'Failed to invite user' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/invite - Remove an invited user
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const existing = await getInvitedUserByEmail(email);
  if (!existing) {
    return NextResponse.json({ error: 'Invited user not found' }, { status: 404 });
  }

  await deleteInvitedUser(email);

  return NextResponse.json({ success: true });
}

// PATCH /api/admin/invite - Update invited user (resend invite, update libraries)
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, librarySectionIds, resendInvite } = body as {
      email: string;
      librarySectionIds?: number[];
      resendInvite?: boolean;
    };

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const existing = await getInvitedUserByEmail(email);
    if (!existing) {
      return NextResponse.json({ error: 'Invited user not found' }, { status: 404 });
    }

    // Resend Plex invite if requested
    if (resendInvite) {
      const plexClient = getPlexAdminClient();
      const shareResult = await plexClient.shareLibrary(
        email,
        librarySectionIds || (existing.librarySectionIds ? JSON.parse(existing.librarySectionIds) : [])
      );

      if (!shareResult.success && !shareResult.alreadyShared) {
        return NextResponse.json(
          { error: shareResult.message || 'Failed to resend Plex invite' },
          { status: 500 }
        );
      }
    }

    // Update whitelist entry
    if (librarySectionIds !== undefined) {
      await updateInvitedUser(email, {
        librarySectionIds: JSON.stringify(librarySectionIds),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update invited user:', error);
    return NextResponse.json(
      { error: 'Failed to update invited user' },
      { status: 500 }
    );
  }
}
