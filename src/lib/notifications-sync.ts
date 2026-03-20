export const NOTIFICATIONS_SYNC_CHANNEL = 'queuearr-notifications-sync';

export type NotificationsSyncMessage = {
  type: 'notifications-seen' | 'notifications-updated';
};

export function createNotificationsSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
    return null;
  }

  return new BroadcastChannel(NOTIFICATIONS_SYNC_CHANNEL);
}

export function emitNotificationsSync(message: NotificationsSyncMessage): void {
  const channel = createNotificationsSyncChannel();
  if (!channel) {
    return;
  }

  channel.postMessage(message);
  channel.close();
}
