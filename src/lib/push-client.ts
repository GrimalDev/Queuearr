'use client';

const SETUP_TIMEOUT_MS = 15_000;

export async function withPushTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), SETUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pushRequest(method: 'GET' | 'POST' | 'DELETE', body?: object): Promise<{ publicKey?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETUP_TIMEOUT_MS);
  try {
    const response = await fetch('/api/push/subscribe', {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Unable to save notification settings. Please retry.');
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Notification setup timed out. Check your connection and retry.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  try {
    // register() reports certificate failures; ready alone can wait forever.
    await withPushTimeout(
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }),
      'The notification service could not start. Check the site certificate and reload.'
    );
    return await withPushTimeout(
      navigator.serviceWorker.ready,
      'The notification service could not start. Check the site certificate and reload.'
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'SecurityError') {
      throw new Error('Notifications require a trusted HTTPS certificate. Ask the administrator to fix the site certificate, then reload.');
    }
    throw error;
  }
}

export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = window.atob((key + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
