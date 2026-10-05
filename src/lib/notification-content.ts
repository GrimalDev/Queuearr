import type { NotificationContent } from '@/types';

export const MAX_NOTIFICATION_TITLE_LENGTH = 200;
export const MAX_NOTIFICATION_BODY_LENGTH = 1000;

export function parseNotificationContent(value: unknown): NotificationContent | null {
  if (!value || typeof value !== 'object') return null;
  const { title, body, url } = value as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_NOTIFICATION_TITLE_LENGTH) return null;
  if (typeof body !== 'string' || !body.trim() || body.length > MAX_NOTIFICATION_BODY_LENGTH) return null;
  if (url !== undefined && url !== null && typeof url !== 'string') return null;

  const relativeUrl = typeof url === 'string' ? url.trim() : '';
  if (relativeUrl && (!relativeUrl.startsWith('/') || relativeUrl.startsWith('//') || /[\\\r\n\t]/.test(relativeUrl))) return null;

  // Validate with trim, but preserve the message's formatting when saving.
  return { title: title.trim(), body, url: relativeUrl || null };
}
