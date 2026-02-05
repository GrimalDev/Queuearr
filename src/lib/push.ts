import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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

// --- Subscription Storage (file-based with mutex) ---
interface PushSubscriptionRecord {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId: string;
  createdAt: string;
}

const DATA_DIR = process.env.QUEUEARR_DATA_DIR || join(process.cwd(), 'data');
const SUBSCRIPTIONS_FILE = join(DATA_DIR, 'push-subscriptions.json');

// Simple in-process mutex to serialize file read-modify-write operations
let writeLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => T): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(() => {
    try {
      return fn();
    } finally {
      resolve!();
    }
  });
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSubscriptions(): PushSubscriptionRecord[] {
  ensureDataDir();
  if (!existsSync(SUBSCRIPTIONS_FILE)) {
    return [];
  }
  try {
    const data = readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveSubscriptions(subscriptions: PushSubscriptionRecord[]): void {
  ensureDataDir();
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

export function addSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userId: string
): Promise<void> {
  return withLock(() => {
    const subscriptions = loadSubscriptions();
    const filtered = subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
    filtered.push({
      ...subscription,
      userId,
      createdAt: new Date().toISOString(),
    });
    saveSubscriptions(filtered);
  });
}

export function removeSubscription(endpoint: string, userId?: string): Promise<void> {
  return withLock(() => {
    const subscriptions = loadSubscriptions();
    saveSubscriptions(
      subscriptions.filter((s) => {
        if (s.endpoint !== endpoint) return true;
        // If userId provided, only remove if it matches (ownership check)
        if (userId && s.userId !== userId) return true;
        return false;
      })
    );
  });
}

export function getSubscriptionsForUser(userId: string): PushSubscriptionRecord[] {
  return loadSubscriptions().filter((s) => s.userId === userId);
}

export function getAllSubscriptions(): PushSubscriptionRecord[] {
  return loadSubscriptions();
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false;
  }

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
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
  const subscriptions = getSubscriptionsForUser(userId);
  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushNotification(sub, payload))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { sent, failed: results.length - sent };
}

export async function broadcastNotification(
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<{ sent: number; failed: number }> {
  const subscriptions = getAllSubscriptions();
  const results = await Promise.allSettled(
    subscriptions.map((sub) => sendPushNotification(sub, payload))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { sent, failed: results.length - sent };
}
