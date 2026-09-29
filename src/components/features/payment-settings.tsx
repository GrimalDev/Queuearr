'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PaymentSettings as Settings } from '@/types';

export function PaymentSettings(): ReactNode {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedUrl, setSavedUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/admin/payments', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load payment settings. Reload to try again.');
        const next: Settings = await response.json();
        setSettings(next);
        setSavedUrl(next.paymentUrl);
      } catch (error) {
        console.error('Failed to load payment settings:', error);
        setMessage('Could not load payment settings. Reload to try again.');
      }
    };
    void load();
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/payments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save payment settings');
      setSettings(result);
      setSavedUrl(result.paymentUrl);
      setMessage('Payment settings saved.');
    } catch (error) {
      console.error('Failed to save payment settings:', error);
      setMessage(error instanceof Error ? error.message : 'Could not save payment settings');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <p role="status" className="text-sm text-muted-foreground">{message || 'Loading payment settings…'}</p>;

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex items-center gap-2">
        <Checkbox id="payment-reminders" checked={settings.enabled} disabled={saving}
          onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked === true })} />
        <Label htmlFor="payment-reminders">Enable voluntary payment reminders</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Reminders also require FAKE_PAYWALL_ENABLED=true in the server environment. The feature is off by default.
      </p>
      <div className="space-y-2">
        <Label htmlFor="payment-url">Payment URL</Label>
        <Input id="payment-url" type="url" required maxLength={2048} value={settings.paymentUrl} disabled={saving}
          onChange={(event) => setSettings({ ...settings, paymentUrl: event.target.value })} />
        <p className="text-xs text-muted-foreground">The QR code and payment button use this link.</p>
      </div>
      {savedUrl && (
        <div className="flex items-center gap-4">
          <QRCodeSVG value={savedUrl} size={112} marginSize={4} level="M" title="Saved payment QR code" className="shrink-0 rounded-lg" />
          <p className="text-xs text-muted-foreground break-all">Saved link: {savedUrl}</p>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Users who confirm payment get one calendar month without reminders. Payment reports are based on trust.
        Choosing Pay later keeps access open and brings the reminder back on the next visit.
      </p>
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save payment settings'}</Button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
