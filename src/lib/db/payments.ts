import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { paymentSettings, users } from '@/lib/db/schema';
import { DEFAULT_PAYMENT_SETTINGS, isFakePaywallEnabled, oneMonthFrom, serializePaymentStatus } from '@/lib/payments';
import type { PaymentReminderStatus, PaymentSettings, PaymentStatus } from '@/types';

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const settings = await db.query.paymentSettings.findFirst({ where: eq(paymentSettings.id, 1) });
  return settings ? { enabled: settings.enabled, paymentUrl: settings.paymentUrl } : DEFAULT_PAYMENT_SETTINGS;
}

export async function savePaymentSettings(settings: PaymentSettings): Promise<void> {
  await db.insert(paymentSettings).values({ id: 1, ...settings }).onConflictDoUpdate({
    target: paymentSettings.id,
    set: settings,
  });
}

export async function getPaymentReminderStatus(userId: string): Promise<PaymentReminderStatus | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;
  const settings = await getPaymentSettings();
  const status = serializePaymentStatus(user);
  const enabled = isFakePaywallEnabled() && settings.enabled;
  return { ...settings, ...status, enabled, shouldRemind: enabled && !status.paymentCurrent };
}

export function recordPaymentChoice(userId: string, action: 'confirm' | 'later'): PaymentStatus | null {
  // Keep duplicate confirmations from different tabs from extending the month.
  return db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return null;
    const now = new Date();
    if (action === 'confirm' && (user.paymentRemindersPausedUntil?.getTime() ?? 0) <= now.getTime()) {
      tx.update(users).set({
        paymentReportedAt: now,
        paymentRemindersPausedUntil: oneMonthFrom(now),
      }).where(eq(users.id, userId)).run();
    } else if (action === 'later') {
      tx.update(users).set({
        paymentDeferredAt: now,
        paymentDeferralCount: sql`${users.paymentDeferralCount} + 1`,
      }).where(eq(users.id, userId)).run();
    }
    const updated = tx.select().from(users).where(eq(users.id, userId)).get();
    return updated ? serializePaymentStatus(updated, now) : null;
  });
}
