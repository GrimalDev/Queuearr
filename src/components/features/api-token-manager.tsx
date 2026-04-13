'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Copy, RefreshCw, Key } from 'lucide-react';

export function ApiTokenManager(): React.JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchToken = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/user/token');
      if (res.ok) {
        const data = await res.json() as { token: string | null };
        setToken(data.token);
      }
    } catch (error) {
      console.error('Failed to fetch API token:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchToken();
  }, [fetchToken]);

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true);
    try {
      const res = await fetch('/api/user/token', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { token: string };
        setToken(data.token);
      }
    } catch (error) {
      console.error('Failed to generate API token:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy token:', error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-muted-foreground" />
          <CardTitle>API Token</CardTitle>
        </div>
        <CardDescription>
          Use this token to query the media status API without requiring a login session.
          Keep it secret — anyone with this token can check your library status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            readOnly
            value={loading ? 'Loading…' : (token ?? 'No token generated yet')}
            type={token ? 'password' : 'text'}
            className="font-mono text-sm"
            aria-label="API token"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleCopy}
            disabled={!token || loading}
            aria-label="Copy token"
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            <Copy className={`h-4 w-4 ${copied ? 'text-green-500' : ''}`} />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={generating || loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? 'animate-spin' : ''}`} />
            {token ? 'Regenerate token' : 'Generate token'}
          </Button>
          {token && (
            <p className="text-xs text-muted-foreground">
              Regenerating will invalidate the current token immediately.
            </p>
          )}
        </div>

        {token && (
          <div className="rounded-md bg-muted p-3 text-xs space-y-1">
            <p className="font-medium">Usage example</p>
            <code className="block break-all text-muted-foreground">
              GET /api/v1/media/status?tmdbId=550&amp;token=YOUR_TOKEN
            </code>
            <code className="block break-all text-muted-foreground">
              Authorization: Bearer YOUR_TOKEN
            </code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
