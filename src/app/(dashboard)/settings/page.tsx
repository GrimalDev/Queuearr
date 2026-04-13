import { NotificationManager } from '@/components/pwa/notification-manager';
import { ApiTokenManager } from '@/components/features/api-token-manager';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your personal preferences</p>
      </div>

      <NotificationManager />
      <ApiTokenManager />
    </div>
  );
}
