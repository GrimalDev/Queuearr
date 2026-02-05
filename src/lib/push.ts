import webpush from 'web-push';
import {
  addPushSubscription as dbAddSubscription,
  removePushSubscription as dbRemoveSubscription,
  getSubscriptionsForUser as dbGetUserSubscriptions,
  getAllSubscriptions as dbGetAllSubscriptions,
} from '@/lib/db/push-subscriptions';
import type { PushSubscription } from '@/lib/db/schema';

// --- VAPID Configuration ---
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@queuearr.local';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function isVapidConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export async function addSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userId: string
): Promise<void> {
  await dbAddSubscription(subscription, userId);
}

export async function removeSubscription(endpoint: string, userId?: string): Promise<void> {
  await dbRemoveSubscription(endpoint, userId);
}

export async function getSubscriptionsForUser(userId: string): Promise<PushSubscription[]> {
  return dbGetUserSubscriptions(userId);
}

export async function getAllSubscriptions(): Promise<PushSubscription[]> {
  return dbGetAllSubscriptions();
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false;
  }

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await removeSubscription(subscription.endpoint);
    }
    console.error('Push notification failed:', error);
    return false;
  }
}

export async function sendToUser(
  userId: string,
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<{ sent: number; failed: number }> {
  const subscriptions = await getSubscriptionsForUser(userId);
  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushNotification(sub, payload))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { sent, failed: results.length - sent };
}

export async function broadcastNotification(
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<{ sent: number; failed: number }> {
  const subscriptions = await getAllSubscriptions();
  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushNotification(sub, payload))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { sent, failed: results.length - sent };
}
