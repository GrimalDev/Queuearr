'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search, Download, Settings, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';

const allNavItems = [
  { href: '/', label: 'Search', icon: Search, adminOnly: false },
  { href: '/queue', label: 'Queue', icon: Download, adminOnly: false },
  { href: '/notifications', label: 'Alerts', icon: Bell, adminOnly: false },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
];

export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin);
  const { unreadCount } = useUnreadNotifications(Boolean(session?.user));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-around px-2 pb-safe">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
