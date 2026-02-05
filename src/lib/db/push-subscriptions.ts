import { eq, and } from 'drizzle-orm';
import { db } from './index';
import { pushSubscriptions } from './schema';
import type { PushSubscription } from './schema';

export async function addPushSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userId: string
): Promise<void> {
  // Use onConflictDoUpdate to handle duplicate endpoints (upsert behavior)
  await db.insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userId,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId,
      },
    });
}

export async function removePushSubscription(
  endpoint: string,
  userId?: string
): Promise<void> {
  // If userId provided, only delete if it matches (ownership check)
  if (userId) {
    await db.delete(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId)
      ));
  } else {
    await db.delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
  }
}

export async function getSubscriptionsForUser(userId: string): Promise<PushSubscription[]> {
  return db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  });
}

export async function getAllSubscriptions(): Promise<PushSubscription[]> {
  return db.query.pushSubscriptions.findMany();
}
