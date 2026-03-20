import { eq, desc, isNull, count } from 'drizzle-orm';
import { db } from './index';
import { notifications } from './schema';
import type { Notification, NewNotification } from './schema';

export async function addNotification(
  notification: Omit<NewNotification, 'sentAt'>
): Promise<Notification> {
  const now = new Date();
  const insertData = {
    ...notification,
    sentAt: now,
  };

  const [inserted] = await db.insert(notifications).values(insertData).returning();
  return inserted;
}

export async function getNotifications(options: {
  page: number;
  limit: number;
  includeDeleted?: boolean;
}): Promise<{ notifications: Notification[]; total: number }> {
  const { page, limit, includeDeleted = false } = options;
  const offset = page * limit;

  const whereCondition = includeDeleted ? undefined : isNull(notifications.deletedAt);

  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(whereCondition);

  const rows = await db
    .select()
    .from(notifications)
    .where(whereCondition)
    .orderBy(desc(notifications.sentAt))
    .limit(limit)
    .offset(offset);

  return { notifications: rows, total };
}

export async function getActiveNotifications(): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(isNull(notifications.deletedAt))
    .orderBy(desc(notifications.sentAt));
}

export async function deleteNotification(id: number): Promise<void> {
  const now = new Date();
  await db
    .update(notifications)
    .set({ deletedAt: now })
    .where(eq(notifications.id, id));
}
