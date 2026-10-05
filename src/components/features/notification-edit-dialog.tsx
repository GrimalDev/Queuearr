'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MAX_NOTIFICATION_BODY_LENGTH, MAX_NOTIFICATION_TITLE_LENGTH, parseNotificationContent } from '@/lib/notification-content';
import type { NotificationRecord } from '@/types';

interface NotificationEditDialogProps {
  notification: NotificationRecord;
  onSaved: (notification: NotificationRecord) => void;
  onClose: () => void;
}

export function NotificationEditDialog({
  notification,
  onSaved,
  onClose,
}: NotificationEditDialogProps): ReactElement {
  const [title, setTitle] = useState(notification.title);
  const [body, setBody] = useState(notification.body);
  const [url, setUrl] = useState(notification.url ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const content = parseNotificationContent({ title, body, url });
    if (!content) {
      setError('Enter a title, a message, and an optional same-site path starting with /.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/notifications/${notification.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!response.ok) {
        throw new Error(response.status === 404
          ? 'This notification no longer exists.'
          : 'Could not save notification. Please try again.');
      }
      const updated: NotificationRecord = await response.json();
      onSaved(updated);
    } catch (error) {
      console.error('Failed to edit notification:', error);
      setError(error instanceof Error ? error.message : 'Could not save notification.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Edit notification</DialogTitle>
          <DialogDescription>
            Update the saved message. This will not send another push notification.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-notification-title">Title</Label>
            <Input id="edit-notification-title" value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_NOTIFICATION_TITLE_LENGTH} disabled={saving} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notification-body">Message</Label>
            <Textarea id="edit-notification-body" value={body} rows={7}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_NOTIFICATION_BODY_LENGTH} disabled={saving} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notification-url">URL (optional)</Label>
            <Input id="edit-notification-url" value={url} placeholder="/notifications"
              onChange={(event) => setUrl(event.target.value)} disabled={saving} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
