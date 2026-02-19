'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PlexLoginButtonProps {
  callbackUrl?: string;
}

export function PlexLoginButton({ callbackUrl = '/' }: PlexLoginButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [pinId, setPinId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pinId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/plex/pin?pinId=${pinId}`);
        const data = await response.json();

        if (data.completed && data.authToken) {
          clearInterval(pollInterval);
          const result = await signIn('plex', {
            authToken: data.authToken,
            redirect: false,
          });

          if (result?.ok) {
            router.push(callbackUrl);
          } else {
            setError('Authentication failed. You may not have access to this server.');
            setIsLoading(false);
            setPinId(null);
          }
        }
      } catch (err) {
        console.error('PIN poll error:', err);
      }
    }, 2000);

    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      setError('Authentication timed out. Please try again.');
      setIsLoading(false);
      setPinId(null);
    }, 180000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [pinId, callbackUrl, router]);

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/plex/pin', { method: 'POST' });
      const data = await response.json();

      if (data.pin && data.authUrl) {
        setPinId(data.pin.id);
        window.open(data.authUrl, 'plex-auth', 'width=800,height=600');
      } else {
        throw new Error('Failed to create PIN');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to start login. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button
        onClick={handleLogin}
        disabled={isLoading}
        className="w-full bg-[#E5A00D] hover:bg-[#CC8C00] text-black"
        size="lg"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {pinId ? 'Waiting for Plex...' : 'Starting...'}
          </>
        ) : (
          <>
            <svg
              className="mr-2 h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M11.643.012c-.106.012-.223.035-.34.06C4.673 1.182-.012 7.204 0 14.095c.009 4.882 2.893 9.066 7.053 11.126.235.116.49.214.756.3.117.04.235.074.354.105.476.125.972.218 1.483.274.117.012.235.023.354.03a12.11 12.11 0 002.004 0c.118-.007.235-.018.354-.03a11.766 11.766 0 001.483-.274c.119-.03.237-.066.354-.105.266-.086.52-.184.756-.3 4.16-2.06 7.044-6.244 7.053-11.126C22.012 7.204 17.327 1.182 10.697.073a3.616 3.616 0 00-.34-.06A11.426 11.426 0 009.989 0c-.123 0-.245.004-.366.012h.02zm-.658 5.623l4.622 6.355-4.622 6.356-4.622-6.356 4.622-6.355z" />
            </svg>
            Sign in with Plex
          </>
        )}
      </Button>

      {isLoading && pinId && (
        <p className="text-sm text-center text-muted-foreground">
          A Plex login window should have opened. Complete the sign-in there.
        </p>
      )}

      {error && (
        <p className="text-sm text-center text-red-500">{error}</p>
      )}
    </div>
  );
}

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              className="h-10 w-10 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              suppressHydrationWarning
            >
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold">Welcome to Queuearr</CardTitle>
          <CardDescription>
            Sign in with your Plex account to manage your media downloads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlexLoginButton />
        </CardContent>
      </Card>
    </div>
  );
}
