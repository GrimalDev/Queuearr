import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPlexAdminClient } from '@/lib/api/plex';
import {
  upsertInvitedUser,
  getInvitedUserByEmail,
  updateInvitedUser,
  getInvitedUsers,
  deleteInvitedUser,
} from '@/lib/db/users';
import {
  InviteEmailConfigurationError,
  sendQueuearrInviteEmail,
} from '@/lib/email/invite';

const DEFAULT_LIMIT = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasMessageHint(result: { message?: string }, hints: string[]): boolean {
  const message = result.message?.toLowerCase() ?? '';
  if (!message) return false;
  return hints.some((hint) => message.includes(hint));
}

function isAlreadySharedFailure(result: { message?: string }): boolean {
  const hints = [
    'already shared',
    'already has access',
    'has already been shared',
  ];
  return hasMessageHint(result, hints);
}

function isAlreadyInvitedFailure(result: { message?: string }): boolean {
  const hints = [
    'already invited',
    'has already been invited',
    'pending invitation',
    'invitation already sent',
    'invite is pending',
  ];
  return hasMessageHint(result, hints);
}

function matchesSharedEmail(
  sharedUser: { email: string | null | undefined },
  normalizedEmail: string
): boolean {
  if (!sharedUser.email || typeof sharedUser.email !== 'string') {
    return false;
  }
  return normalizeInviteEmail(sharedUser.email) === normalizedEmail;
}

function resolveQueuearrUrl(): string {
  const configuredUrl = process.env.NEXTAUTH_URL?.trim();
  if (!configuredUrl) {
    throw new InviteEmailConfigurationError('NEXTAUTH_URL is required for invite emails');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new InviteEmailConfigurationError('NEXTAUTH_URL must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new InviteEmailConfigurationError('NEXTAUTH_URL must use http or https');
  }

  const normalizedUrl = parsedUrl.toString();
  return normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;
}

function parseLibrarySectionIds(
  librarySectionIds: unknown
): { valid: true; values?: number[] } | { valid: false; error: string } {
  if (librarySectionIds === undefined) {
    return { valid: true };
  }

  if (!Array.isArray(librarySectionIds)) {
    return { valid: false, error: 'librarySectionIds must be an array of integers' };
  }

  if (librarySectionIds.length === 0) {
    return { valid: false, error: 'Please select at least one library' };
  }

  const normalizedIds = librarySectionIds.map((id) => Number(id));
  const hasInvalidId = normalizedIds.some((id) => !Number.isInteger(id) || id <= 0);
  if (hasInvalidId) {
    return { valid: false, error: 'librarySectionIds must contain only positive integers' };
  }

  return { valid: true, values: [...new Set(normalizedIds)] };
}

function parseStoredLibrarySectionIds(
  serializedIds: string | null,
  options?: { allowLegacyAllLibraries?: boolean }
): { valid: true; values: number[]; usedLegacyAllLibraries?: boolean } | { valid: false; error: string } {
  const allowLegacyAllLibraries = options?.allowLegacyAllLibraries ?? false;

  if (!serializedIds) {
    if (allowLegacyAllLibraries) {
      return { valid: true, values: [], usedLegacyAllLibraries: true };
    }
    return {
      valid: false,
      error: 'No libraries configured for this invite. Please select libraries before resending.',
    };
  }

  try {
    const parsed = JSON.parse(serializedIds) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      if (allowLegacyAllLibraries) {
        return { valid: true, values: [], usedLegacyAllLibraries: true };
      }
      return {
        valid: false,
        error: 'No libraries configured for this invite. Please select libraries before resending.',
      };
    }

    const normalizedIds = parsed.map((id) => Number(id));
    const hasInvalidId = normalizedIds.some((id) => !Number.isInteger(id) || id <= 0);
    if (hasInvalidId) {
      return {
        valid: false,
        error: 'Stored invite libraries are invalid. Please set libraries and resend.',
      };
    }

    return { valid: true, values: [...new Set(normalizedIds)], usedLegacyAllLibraries: false };
  } catch (error) {
    console.error('Failed to parse stored library section ids:', error);
    return {
      valid: false,
      error: 'Stored invite libraries are invalid. Please set libraries and resend.',
    };
  }
}

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
      librarySectionIds?: unknown;
    };

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = normalizeInviteEmail(email);

    // Validate email format
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const parsedLibrarySectionIds = parseLibrarySectionIds(librarySectionIds);
    if (!parsedLibrarySectionIds.valid) {
      return NextResponse.json({ error: parsedLibrarySectionIds.error }, { status: 400 });
    }

    const existing = await getInvitedUserByEmail(normalizedEmail);
    let effectiveLibrarySectionIds = parsedLibrarySectionIds.values;
    if (!effectiveLibrarySectionIds) {
      if (!existing) {
        return NextResponse.json(
          { error: 'Please select at least one library' },
          { status: 400 }
        );
      }

      const parsedStoredLibraryIds = parseStoredLibrarySectionIds(existing.librarySectionIds ?? null);
      if (!parsedStoredLibraryIds.valid) {
        return NextResponse.json({ error: parsedStoredLibraryIds.error }, { status: 400 });
      }
      effectiveLibrarySectionIds = parsedStoredLibraryIds.values;
    }

    try {
      const queuearrUrl = resolveQueuearrUrl();
      await sendQueuearrInviteEmail({
        to: normalizedEmail,
        queuearrUrl,
      });
    } catch (error) {
      console.error('Failed to send Queuearr invite email:', error);
      if (error instanceof InviteEmailConfigurationError) {
        return NextResponse.json(
          { error: 'Invite email is not configured. Check SMTP and NEXTAUTH_URL settings.' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to send Queuearr invite email' },
        { status: 502 }
      );
    }

    // Send Plex invite after Queuearr email
    const plexClient = getPlexAdminClient();
    let shareResult = await plexClient.shareLibrary(normalizedEmail, effectiveLibrarySectionIds);

    if (!shareResult.success) {
      if (isAlreadyInvitedFailure(shareResult)) {
        shareResult = {
          success: true,
          alreadyInvited: true,
          message: 'Plex invitation already pending for this user',
        };
      } else if (isAlreadySharedFailure(shareResult)) {
        try {
          const sharedUsers = await plexClient.getSharedUsers();
          const alreadyShared = sharedUsers.some(
            (sharedUser) => matchesSharedEmail(sharedUser, normalizedEmail)
          );
          if (alreadyShared) {
            shareResult = {
              success: true,
              alreadyShared: true,
              message: 'Already shared with this user',
            };
          }
        } catch (error) {
          console.error('Failed to verify existing Plex share after invite failure:', error);
        }
      }
    }

    if (!shareResult.success) {
      await upsertInvitedUser({
        email: normalizedEmail,
        librarySectionIds:
          JSON.stringify(effectiveLibrarySectionIds),
        invitedBy: session.user.id,
        plexInviteSent: false,
      });

      return NextResponse.json(
        {
          error: 'Queuearr email was sent, but Plex invite failed. Use Resend to retry Plex delivery.',
          queuearrEmailSent: true,
          plexInviteSent: false,
        },
        { status: 502 }
      );
    }

    // Upsert whitelist entry to support reliable re-invite/resend
    const invitedUser = await upsertInvitedUser({
      email: normalizedEmail,
      librarySectionIds: JSON.stringify(effectiveLibrarySectionIds),
      invitedBy: session.user.id,
      plexInviteSent: true,
    });

    return NextResponse.json({
      success: true,
      invitedUser,
      resent: !!existing,
      queuearrEmailSent: true,
      plexInviteSent: true,
      plexAlreadyShared: shareResult.alreadyShared,
      plexAlreadyInvited: shareResult.alreadyInvited,
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

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const normalizedEmail = normalizeInviteEmail(email);
  const existing = await getInvitedUserByEmail(normalizedEmail);
  if (!existing) {
    return NextResponse.json({ error: 'Invited user not found' }, { status: 404 });
  }

    try {
      const plexClient = getPlexAdminClient();

      const [sharedUsers, pendingInvites] = await Promise.all([
        plexClient.getSharedUsers(),
        plexClient.getPendingInvites(),
      ]);

      const sharedUser = sharedUsers.find((user) => matchesSharedEmail(user, normalizedEmail));
      if (sharedUser) {
        const removed = await plexClient.removeShare(sharedUser.id);
        if (!removed) {
          return NextResponse.json(
            { error: 'Failed to revoke Plex library access for this invite. Please retry.' },
            { status: 502 }
          );
        }
      }

      const pendingInvite = pendingInvites.find((invite) =>
        matchesSharedEmail(invite, normalizedEmail)
      );
      if (pendingInvite) {
        await plexClient.cancelPendingInvite(pendingInvite.id);
      }
    } catch (error) {
      console.error('Failed while revoking Plex share during invite deletion:', error);
      return NextResponse.json(
        { error: 'Failed to validate/revoke Plex share for this invite. Please retry.' },
        { status: 502 }
      );
    }

  await deleteInvitedUser(normalizedEmail);

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
      librarySectionIds?: unknown;
      resendInvite?: boolean;
    };

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = normalizeInviteEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const parsedLibrarySectionIds = parseLibrarySectionIds(librarySectionIds);
    if (!parsedLibrarySectionIds.valid) {
      return NextResponse.json({ error: parsedLibrarySectionIds.error }, { status: 400 });
    }

    const existing = await getInvitedUserByEmail(normalizedEmail);
    if (!existing) {
      return NextResponse.json({ error: 'Invited user not found' }, { status: 404 });
    }

    let effectiveLibrarySectionIds = parsedLibrarySectionIds.values;
    let legacyAllLibrariesFallback = false;
    if (resendInvite && !effectiveLibrarySectionIds) {
      const parsedStoredLibraryIds = parseStoredLibrarySectionIds(existing.librarySectionIds ?? null, {
        allowLegacyAllLibraries: true,
      });
      if (!parsedStoredLibraryIds.valid) {
        return NextResponse.json({ error: parsedStoredLibraryIds.error }, { status: 400 });
      }
      effectiveLibrarySectionIds = parsedStoredLibraryIds.values;
      legacyAllLibrariesFallback = !!parsedStoredLibraryIds.usedLegacyAllLibraries;
    }

    let plexAlreadyShared = false;
    let plexAlreadyInvited = false;

    // Resend Plex invite if requested
    if (resendInvite) {
      try {
        const queuearrUrl = resolveQueuearrUrl();
        await sendQueuearrInviteEmail({
          to: normalizedEmail,
          queuearrUrl,
        });
      } catch (error) {
        console.error('Failed to send Queuearr invite email:', error);
        if (error instanceof InviteEmailConfigurationError) {
          return NextResponse.json(
            { error: 'Invite email is not configured. Check SMTP and NEXTAUTH_URL settings.' },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: 'Failed to send Queuearr invite email' },
          { status: 502 }
        );
      }

      const plexClient = getPlexAdminClient();
      let shareResult = await plexClient.shareLibrary(
        normalizedEmail,
        effectiveLibrarySectionIds ?? []
      );

      if (!shareResult.success) {
        if (isAlreadyInvitedFailure(shareResult)) {
          shareResult = {
            success: true,
            alreadyInvited: true,
            message: 'Plex invitation already pending for this user',
          };
        } else if (isAlreadySharedFailure(shareResult)) {
          try {
            const sharedUsers = await plexClient.getSharedUsers();
            const alreadyShared = sharedUsers.some(
              (sharedUser) => matchesSharedEmail(sharedUser, normalizedEmail)
            );
            if (alreadyShared) {
              shareResult = {
                success: true,
                alreadyShared: true,
                message: 'Already shared with this user',
              };
            }
          } catch (error) {
            console.error('Failed to verify existing Plex share after resend failure:', error);
          }
        }
      }

      if (!shareResult.success) {
        await updateInvitedUser(normalizedEmail, {
          librarySectionIds:
            JSON.stringify(effectiveLibrarySectionIds ?? []),
          invitedAt: new Date(),
          invitedBy: session.user.id,
          plexInviteSent: false,
        });

        return NextResponse.json(
          {
            error: 'Queuearr email was sent, but Plex invite failed. Use Resend to retry Plex delivery.',
            queuearrEmailSent: true,
            plexInviteSent: false,
            legacyAllLibrariesFallback,
          },
          { status: 502 }
        );
      }

      plexAlreadyShared = !!shareResult.alreadyShared;
      plexAlreadyInvited = !!shareResult.alreadyInvited;
    }

    // Update whitelist entry
    if (parsedLibrarySectionIds.values !== undefined || resendInvite) {
      await updateInvitedUser(normalizedEmail, {
        librarySectionIds:
          JSON.stringify(effectiveLibrarySectionIds ?? []),
        invitedAt: resendInvite ? new Date() : existing.invitedAt,
        invitedBy: session.user.id,
        plexInviteSent: resendInvite ? true : existing.plexInviteSent,
      });
    }

    return NextResponse.json({
      success: true,
      queuearrEmailSent: resendInvite ? true : undefined,
      plexInviteSent: resendInvite ? true : undefined,
      plexAlreadyShared,
      plexAlreadyInvited: resendInvite ? plexAlreadyInvited : undefined,
      legacyAllLibrariesFallback,
    });
  } catch (error) {
    console.error('Failed to update invited user:', error);
    return NextResponse.json(
      { error: 'Failed to update invited user' },
      { status: 500 }
    );
  }
}
