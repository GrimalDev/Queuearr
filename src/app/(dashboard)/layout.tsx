import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Providers } from '@/components/providers';
import { MainNav } from '@/components/features/main-nav';
import { BottomNav } from '@/components/features/bottom-nav';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { NotificationReminder } from '@/components/pwa/notification-reminder';
import { PaymentReminder } from '@/components/features/payment-reminder';
import { isFakePaywallEnabled } from '@/lib/payments';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <Providers session={session}>
      <div className="min-h-screen flex flex-col">
        <MainNav initialSession={session} />
        <main className="flex-1 container mx-auto py-6 px-4 pb-24 md:pb-6">{children}</main>
        <BottomNav />
        {isFakePaywallEnabled() ? (
          <PaymentReminder key={session.user.id}>
            <InstallPrompt />
            <NotificationReminder />
          </PaymentReminder>
        ) : (
          <>
            <InstallPrompt />
            <NotificationReminder />
          </>
        )}
      </div>
    </Providers>
  );
}
