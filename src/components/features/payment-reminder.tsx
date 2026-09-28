'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Clock, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PaymentReminderStatus } from '@/types';

type PaymentStep = 'loading' | 'prompt' | 'payment' | 'closed';

export function PaymentReminder({ children }: { children?: ReactNode }): ReactNode {
  const [step, setStep] = useState<PaymentStep>('loading');
  const [status, setStatus] = useState<PaymentReminderStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/user/payment', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load payment reminder');
      const next: PaymentReminderStatus = await response.json();
      setStatus(next);
      setStep(next.shouldRemind ? 'prompt' : 'closed');
    } catch (error) {
      console.error('Failed to load payment reminder:', error);
      // A voluntary contribution never prevents access when the server is unavailable.
      setStep('closed');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onReturn = (): void => {
      // Keep the QR/confirmation screen when returning from the payment app.
      if (document.visibilityState === 'visible' && step === 'closed' && !busy.current) {
        void refresh();
      }
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) onReturn();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh, step]);

  const chooseLater = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setStep('closed');
    setError(null);
    try {
      const response = await fetch('/api/user/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'later' }),
        keepalive: true,
      });
      if (!response.ok) throw new Error('Could not record Pay later');
    } catch (error) {
      console.error('Failed to record payment deferral:', error);
    } finally {
      busy.current = false;
    }
  };

  const confirmPayment = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/user/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      if (!response.ok) throw new Error('Could not save your payment confirmation. Please try again.');
      setStep('closed');
    } catch (error) {
      console.error('Failed to confirm payment:', error);
      setError('Could not save your payment confirmation. Please try again.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const open = step === 'prompt' || step === 'payment';
  return (
    <>
      <Dialog open={open} onOpenChange={(open) => { if (!open) void chooseLater(); }}>
        <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{step === 'payment' ? 'Make a contribution' : 'Support our services'}</DialogTitle>
            <DialogDescription>
              {step === 'payment'
                ? 'Scan the code or open the payment link. Once you have paid, confirm below to pause reminders for one month.'
                : 'Contributing is voluntary. You can pay later and keep using the site.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
            <p className="font-semibold">$5 per month</p>
            <p className="text-sm text-muted-foreground">
              Your contribution helps cover the infrastructure and operating costs of all the services we provide. We&apos;ll lower the price in the future if costs allow.
            </p>
          </div>
          {step === 'payment' && status && (
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={status.paymentUrl} size={224} marginSize={4} level="M"
                title="Scan to open the payment link" className="max-w-full rounded-lg" />
              <Button asChild variant="outline" className="w-full">
                <a href={status.paymentUrl} target="_blank" rel="noopener noreferrer">
                  Open payment link <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <p className="text-xs text-muted-foreground break-all">{status.paymentUrl}</p>
              <p className="text-xs text-muted-foreground text-center">
                Your confirmation is based on trust. Queuearr does not verify the transfer.
              </p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => void chooseLater()} disabled={saving}>
              <Clock className="h-4 w-4" aria-hidden="true" /> Pay later
            </Button>
            {step === 'payment' ? (
              <Button onClick={() => void confirmPayment()} disabled={saving}>
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Check className="h-4 w-4" aria-hidden="true" />} I&apos;ve paid
              </Button>
            ) : (
              <Button onClick={() => setStep('payment')}>
                <CreditCard className="h-4 w-4" aria-hidden="true" /> Pay now
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {step === 'closed' && children}
    </>
  );
}
