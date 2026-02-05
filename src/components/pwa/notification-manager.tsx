'use client';

import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export function NotificationManager() {
  const {
    isSupported,
    isSubscribed,
    permissionState,
    isLoading,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not supported in this browser.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (permissionState === 'denied') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Notification permission has been denied. Please enable notifications in your browser settings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isSubscribed ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          Push Notifications
        </CardTitle>
        <CardDescription>
          {isSubscribed
            ? 'You will receive notifications when downloads complete or encounter errors.'
            : 'Enable push notifications to get alerts about your downloads.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={isSubscribed ? unsubscribe : subscribe}
          disabled={isLoading}
          variant={isSubscribed ? 'destructive' : 'default'}
        >
          {isLoading
            ? 'Loading...'
            : isSubscribed
              ? 'Disable Notifications'
              : 'Enable Notifications'}
        </Button>
      </CardContent>
    </Card>
  );
}
