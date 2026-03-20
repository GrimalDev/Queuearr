'use client';

import { useCallback, useEffect, useState } from 'react';
import { createNotificationsSyncChannel } from '@/lib/notifications-sync';

export function useUnreadNotifications(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    if (!enabled) {
      setUnreadCount(0);
      return;
    }

    try {
      const response = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }

      const data = await response.json() as { unreadCount?: number };
      setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
    } catch {
      setUnreadCount(0);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setUnreadCount(0);
      return;
    }

    fetchUnreadCount();

    const intervalId = setInterval(fetchUnreadCount, 30000);
    const syncChannel = createNotificationsSyncChannel();

    if (syncChannel) {
      syncChannel.onmessage = () => {
        void fetchUnreadCount();
      };
    }

    return () => {
      clearInterval(intervalId);
      if (syncChannel) {
        syncChannel.close();
      }
    };
  }, [enabled, fetchUnreadCount]);

  return { unreadCount, refreshUnreadCount: fetchUnreadCount };
}
