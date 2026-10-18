'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPushRegistration, pushRequest, vapidKeyBytes, withPushTimeout } from '@/lib/push-client';
import { useAppStore } from '@/store/app-store';
import type { PushNotificationsState } from '@/types';

const SUBSCRIPTION_CHANGED = 'queuearr:push-subscription-changed';

function broadcastSubscription(subscription: PushSubscription | null): void {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_CHANGED, { detail: subscription }));
}

export function usePushNotifications(): PushNotificationsState {
  const [isSupported, setIsSupported] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const supported = window.isSecureContext && 'Notification' in window &&
      'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);
    if (!supported) {
      setIsReady(true);
      return;
    }

    let active = true;
    const initialRevision = revision.current;
    setPermissionState(Notification.permission);
    const onChange = (event: Event): void => {
      revision.current++;
      setSubscription((event as CustomEvent<PushSubscription | null>).detail);
      setPermissionState(Notification.permission);
      setError(null);
    };
    window.addEventListener(SUBSCRIPTION_CHANGED, onChange);

    const restore = async (): Promise<void> => {
      try {
        // Do not wait indefinitely for a service worker that failed registration.
        const registration = await withPushTimeout(navigator.serviceWorker.getRegistration('/'), 'Notification setup timed out.');
        const sub = registration ? await withPushTimeout(registration.pushManager.getSubscription(), 'Notification setup timed out.') : null;
        if (sub && Notification.permission === 'granted') {
          // Restore server registration after a database restore or an account change.
          await pushRequest('POST', { subscription: sub.toJSON() });
          if (active && revision.current === initialRevision) setSubscription(sub);
        }
      } catch {
        // Explicit setup offers a retry and reports errors to the user.
      } finally {
        if (active) setIsReady(true);
      }
    };
    void restore();
    return () => {
      active = false;
      window.removeEventListener(SUBSCRIPTION_CHANGED, onChange);
    };
  }, []);

  const reportError = useCallback((cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : 'Notification setup failed. Please retry.';
    setError(message);
    console.error('Notification setup failed:', cause);
    useAppStore.getState().addAlert({ type: 'error', source: 'system', title: 'Notifications', message });
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported || busy.current) return false;
    busy.current = true;
    revision.current++;
    setIsLoading(true);
    setError(null);
    try {
      // Keep this call directly in the click handler so the browser sees the user gesture.
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked. Enable them in your browser site settings.'
          : 'Permission was not granted. You can retry or close this reminder.');
      }
      const { publicKey } = await pushRequest('GET');
      if (!publicKey) throw new Error('The server did not provide a notification public key. Contact the administrator.');
      const registration = await getPushRegistration();
      let sub = await withPushTimeout(registration.pushManager.getSubscription(), 'Notification setup timed out. Please retry.');
      const key = vapidKeyBytes(publicKey);
      const existingKey = sub?.options.applicationServerKey;
      if (sub && existingKey && (existingKey.byteLength !== key.byteLength || !new Uint8Array(existingKey).every((byte, index) => byte === key[index]))) {
        await withPushTimeout(sub.unsubscribe(), 'Notification setup timed out. Please retry.');
        sub = null;
        broadcastSubscription(null);
      }
      sub ??= await withPushTimeout(registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }), 'Notification setup timed out. Please retry.');
      // A browser subscription alone does not mean Queuearr can send to it.
      await pushRequest('POST', { subscription: sub.toJSON() });
      setSubscription(sub);
      broadcastSubscription(sub);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  }, [isSupported, reportError]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!subscription || busy.current) return false;
    busy.current = true;
    revision.current++;
    setIsLoading(true);
    setError(null);
    try {
      await pushRequest('DELETE', { endpoint: subscription.endpoint });
      await withPushTimeout(subscription.unsubscribe(), 'Disabling notifications timed out. Please retry.');
      setSubscription(null);
      broadcastSubscription(null);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  }, [subscription, reportError]);

  return { isSupported, isReady, subscription, permissionState, isLoading, error, subscribe, unsubscribe, isSubscribed: !!subscription };
}
