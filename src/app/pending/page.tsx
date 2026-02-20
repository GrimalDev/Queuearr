import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserById } from '@/lib/db/users';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SignOutButton } from './sign-out-button';

export default async function PendingPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  const dbUser = await getUserById(session.user.id);

  // If account is now active, send them to the dashboard
  if (dbUser?.active) {
    redirect('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Avatar className="h-16 w-16">
                <AvatarImage src={session.user.image ?? undefined} alt={session.user.name ?? ''} />
                <AvatarFallback className="text-xl">
                  {(session.user.name ?? 'U')[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-background border">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </div>
          </div>
          <CardTitle className="text-xl">Waiting for Approval</CardTitle>
          <CardDescription>
            Hi <span className="font-medium text-foreground">{session.user.name}</span>, your
            account is pending admin approval. An admin has been notified and will review your
            request shortly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground text-center">
            You&apos;ll receive a push notification once your account is activated — if you have
            notifications enabled.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
