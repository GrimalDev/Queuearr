'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={() => signOut({ callbackUrl: '/login' })}
    >
      <LogOut className="h-4 w-4 mr-2" />
      Sign out
    </Button>
  );
}
