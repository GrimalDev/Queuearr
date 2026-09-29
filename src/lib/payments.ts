import type { PaymentSettings, PaymentStatus } from '@/types';

export function isFakePaywallEnabled(): boolean {
  return process.env.FAKE_PAYWALL_ENABLED === 'true';
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  enabled: true,
  paymentUrl: 'https://revolut.me/grimaldev',
};

export function oneMonthFrom(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function serializePaymentStatus(user: {
  paymentReportedAt: Date | null;
  paymentRemindersPausedUntil: Date | null;
  paymentDeferredAt: Date | null;
  paymentDeferralCount: number;
}, now: Date = new Date()): PaymentStatus {
  return {
    paymentReportedAt: user.paymentReportedAt?.toISOString() ?? null,
    paymentRemindersPausedUntil: user.paymentRemindersPausedUntil?.toISOString() ?? null,
    paymentDeferredAt: user.paymentDeferredAt?.toISOString() ?? null,
    paymentDeferralCount: user.paymentDeferralCount,
    paymentCurrent: (user.paymentRemindersPausedUntil?.getTime() ?? 0) > now.getTime(),
  };
}

export function parsePaymentSettings(value: unknown): PaymentSettings | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean' || typeof body.paymentUrl !== 'string') return null;
  const paymentUrl = body.paymentUrl.trim();
  if (paymentUrl.length > 2048) return null;
  try {
    const url = new URL(paymentUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return { enabled: body.enabled, paymentUrl: url.toString() };
  } catch {
    return null;
  }
}
