'use client';

import { X, AlertTriangle, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const alertIcons = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

const alertVariants = {
  error: 'border-red-500/50 text-red-500 [&>svg]:text-red-500',
  warning: 'border-yellow-500/50 text-yellow-600 [&>svg]:text-yellow-600',
  info: 'border-blue-500/50 text-blue-500 [&>svg]:text-blue-500',
  success: 'border-green-500/50 text-green-500 [&>svg]:text-green-500',
};

export function AlertsPanel() {
  const { alerts, dismissAlert, clearAlerts } = useAppStore();
  const visibleAlerts = alerts.filter((a) => !a.dismissed);

  if (visibleAlerts.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <div className="bg-background border rounded-lg shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <span className="text-sm font-medium">
            Alerts ({visibleAlerts.length})
          </span>
          <Button variant="ghost" size="sm" onClick={clearAlerts}>
            Clear All
          </Button>
        </div>
        <ScrollArea className="max-h-80">
          <div className="p-2 space-y-2">
            {visibleAlerts.map((alert) => {
              const Icon = alertIcons[alert.type];
              return (
                <Alert
                  key={alert.id}
                  className={cn('relative pr-8', alertVariants[alert.type])}
                >
                  <Icon className="h-4 w-4" />
                  <AlertTitle className="text-sm font-medium">{alert.title}</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    {alert.message}
                    <div className="text-[10px] mt-1 opacity-70">
                      {alert.timestamp.toLocaleTimeString()} • {alert.source}
                    </div>
                  </AlertDescription>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-6 w-6 p-0"
                    onClick={() => dismissAlert(alert.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Alert>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
