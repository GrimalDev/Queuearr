import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Providers } from '@/components/providers';
import { MainNav } from '@/components/features/main-nav';
import { InstallPrompt } from '@/components/pwa/install-prompt';

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
    <Providers>
      <div className="min-h-screen flex flex-col">
        <MainNav />
        <main className="flex-1 container mx-auto py-6">{children}</main>
        <InstallPrompt />
      </div>
    </Providers>
  );
}
