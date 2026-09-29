import { getPlexAdminClient } from '@/lib/api/plex';
import {
  deleteRegisteredUserInvites,
  deleteUnchangedInvite,
  getAllInvitedUsers,
  getInvitedUserByEmail,
} from '@/lib/db/users';
import { getInviteExpiresAt } from '@/lib/invite-policy';

const CLEANUP_INTERVAL_MS = 60_000;
const cleanupState = globalThis as typeof globalThis & {
  queuearrInviteCleanup?: Promise<boolean>;
  queuearrInviteCleanupTimer?: ReturnType<typeof setInterval>;
};

async function runCleanup(): Promise<boolean> {
  try {
    // Successful Queuearr sign-in proves access, even when Plex is unavailable.
    await deleteRegisteredUserInvites();
    const invites = await getAllInvitedUsers();
    if (invites.length === 0) return true;

    const plexClient = getPlexAdminClient();
    // Read pending invites first so acceptance during this check is handled
    // conservatively. Never revoke an accepted library share during cleanup.
    const pendingInvites = await plexClient.getPendingInvites();
    if (pendingInvites.some((invite) => !invite.email.trim())) {
      throw new Error('Plex returned a pending invite without an email; cleanup deferred');
    }
    const sharedUsers = await plexClient.getSharedUsers();
    const normalize = (email: string): string => email.trim().toLowerCase();
    let complete = true;

    for (const invite of invites) {
      const email = normalize(invite.email);
      const pending = pendingInvites.filter((entry) => normalize(entry.email) === email);
      const shared = sharedUsers.some((entry) => normalize(entry.email) === email);

      if (shared && pending.length === 0) {
        await deleteUnchangedInvite(invite);
      } else if (getInviteExpiresAt(invite.invitedAt).getTime() <= Date.now()) {
        const current = await getInvitedUserByEmail(invite.email);
        if (
          !current || current.id !== invite.id ||
          current.invitedAt?.getTime() !== invite.invitedAt?.getTime()
        ) continue;
        let cancelled = true;
        for (const entry of pending) {
          if (!(await plexClient.cancelPendingInvite(entry.id))) cancelled = false;
        }
        if (cancelled) {
          await deleteUnchangedInvite(invite);
        } else {
          // Keep the record so the next pass can retry the remote cancellation.
          complete = false;
        }
      }
    }
    return complete;
  } catch (error) {
    console.error('[invites] Cleanup failed; will retry:', error);
    return false;
  }
}

export function cleanupInvites(): Promise<boolean> {
  if (!cleanupState.queuearrInviteCleanup) {
    cleanupState.queuearrInviteCleanup = runCleanup().finally(() => {
      cleanupState.queuearrInviteCleanup = undefined;
    });
  }
  return cleanupState.queuearrInviteCleanup;
}

export function startInviteCleanup(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || cleanupState.queuearrInviteCleanupTimer) return;
  void cleanupInvites();
  cleanupState.queuearrInviteCleanupTimer = setInterval(() => void cleanupInvites(), CLEANUP_INTERVAL_MS);
  cleanupState.queuearrInviteCleanupTimer.unref();
}
