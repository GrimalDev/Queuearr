'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePushNotifications } from '@/hooks/use-push-notifications';

const NEVER_REMIND_KEY = 'push-notification-reminder-never';

export function NotificationReminder() {
  const { isSupported, isSubscribed, permissionState, isLoading, subscribe } = usePushNotifications();
  const [neverSelected, setNeverSelected] = useState(false);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const [neverRemind, setNeverRemind] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem(NEVER_REMIND_KEY) === 'true'
  );

  const shouldShowReminder = useMemo(
    () =>
      isSupported &&
      !neverRemind &&
      !dismissedForSession &&
      permissionState !== 'denied' &&
      !isSubscribed,
    [isSupported, neverRemind, dismissedForSession, permissionState, isSubscribed]
  );

  const handleEnable = async () => {
    await subscribe();
  };

  const handleNever = () => {
    localStorage.setItem(NEVER_REMIND_KEY, 'true');
    setNeverRemind(true);
    setNeverSelected(true);
  };

  if (!shouldShowReminder && !neverSelected) return null;

  const handleOpenChange = (open: boolean) => {
    if (!open && !neverSelected) {
      setDismissedForSession(true);
    }
  };

  return (
    <Dialog open={shouldShowReminder || neverSelected} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!neverSelected}>
        <DialogHeader>
          <DialogTitle>Enable notifications?</DialogTitle>
          {!neverSelected ? (
            <DialogDescription>
              Turn on notifications to get updates right away.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Got it. You can still enable notifications anytime from your profile menu.
            </DialogDescription>
          )}
        </DialogHeader>
        {!neverSelected ? (
          <DialogFooter>
            <Button variant="outline" onClick={handleNever}>
              Never
            </Button>
            <Button onClick={handleEnable} disabled={isLoading}>
              Enable Notifications
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button
              onClick={() => {
                setNeverSelected(false);
                setDismissedForSession(true);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
