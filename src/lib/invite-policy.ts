export const INVITE_LIFETIME_DAYS = 7;

export function getInviteExpiresAt(invitedAt: Date | null): Date {
  // Legacy records without a send date are already expired.
  return new Date((invitedAt?.getTime() ?? 0) + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}
