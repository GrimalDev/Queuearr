'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Check, X, Loader2, RefreshCw, Trash2, ShieldCheck, ShieldOff, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ServiceStatus {
  name: string;
  configured: boolean;
  connected: boolean;
  error?: string;
}

interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}

const PAGE_SIZE = 10;

interface UsersPage {
  users: UserRecord[];
  total: number;
}

function UsersManager() {
  const { data: session } = useSession();
  const [data, setData] = useState<UsersPage>({ users: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const fetchUsers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (q) params.set('search', q);
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(page, search); }, [fetchUsers, page, search]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  const toggleRole = async (user: UserRecord) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    await fetchUsers(page, search);
  };

  const removeUser = async (user: UserRecord) => {
    await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    await fetchUsers(page, search);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.users.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>
      ) : (
        data.users.map((user) => {
          const isSelf = user.id === session?.user?.id;
          return (
            <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={user.avatarUrl || undefined} alt={user.username} />
                  <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{user.username}</p>
                  {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {user.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isSelf}
                  onClick={() => toggleRole(user)}
                  title={user.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                >
                  {user.role === 'admin' ? (
                    <ShieldOff className="h-4 w-4" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isSelf}
                  onClick={() => removeUser(user)}
                  title="Delete user"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {data.total} user{data.total !== 1 ? 's' : ''}
            {search ? ' found' : ''} &mdash; page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);

  const checkServices = async () => {
    setIsTesting(true);
    try {
      const results: ServiceStatus[] = [];

      const radarrRes = await fetch('/api/radarr/queue').catch(() => null);
      results.push({
        name: 'Radarr',
        configured: radarrRes?.status !== 503,
        connected: radarrRes?.ok || false,
        error: radarrRes?.status === 503 ? 'Not configured' : radarrRes?.ok ? undefined : 'Connection failed',
      });

      const sonarrRes = await fetch('/api/sonarr/queue').catch(() => null);
      results.push({
        name: 'Sonarr',
        configured: sonarrRes?.status !== 503,
        connected: sonarrRes?.ok || false,
        error: sonarrRes?.status === 503 ? 'Not configured' : sonarrRes?.ok ? undefined : 'Connection failed',
      });

      const transmissionRes = await fetch('/api/transmission').catch(() => null);
      results.push({
        name: 'Transmission',
        configured: transmissionRes?.status !== 503,
        connected: transmissionRes?.ok || false,
        error: transmissionRes?.status === 503 ? 'Not configured' : transmissionRes?.ok ? undefined : 'Connection failed',
      });

      setServices(results);
    } catch (error) {
      console.error('Service check error:', error);
    } finally {
      setIsTesting(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkServices();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your Queuearr instance
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Manage user accounts and admin privileges
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersManager />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Service Status</CardTitle>
              <CardDescription>
                Check the connection status of your configured services
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={checkServices} disabled={isTesting}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isTesting ? 'animate-spin' : ''}`} />
              Test Connections
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {services.map((service) => (
                <div
                  key={service.name}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3 w-3 rounded-full ${
                        service.connected
                          ? 'bg-green-500'
                          : service.configured
                            ? 'bg-yellow-500'
                            : 'bg-gray-400'
                      }`}
                    />
                    <div>
                      <p className="font-medium">{service.name}</p>
                      {service.error && (
                        <p className="text-sm text-muted-foreground">{service.error}</p>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={
                      service.connected
                        ? 'default'
                        : service.configured
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {service.connected ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        Connected
                      </>
                    ) : service.configured ? (
                      <>
                        <X className="h-3 w-3 mr-1" />
                        Error
                      </>
                    ) : (
                      'Not Configured'
                    )}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Configuration</CardTitle>
          <CardDescription>
            Services are configured via environment variables. Update your .env file and restart the application to apply changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium">Radarr</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>RADARR_URL</Label>
                <Input
                  placeholder="http://localhost:7878"
                  disabled
                  value={process.env.NEXT_PUBLIC_RADARR_URL || ''}
                />
              </div>
              <div className="space-y-2">
                <Label>RADARR_API_KEY</Label>
                <Input type="password" placeholder="••••••••••••" disabled />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Sonarr</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>SONARR_URL</Label>
                <Input
                  placeholder="http://localhost:8989"
                  disabled
                  value={process.env.NEXT_PUBLIC_SONARR_URL || ''}
                />
              </div>
              <div className="space-y-2">
                <Label>SONARR_API_KEY</Label>
                <Input type="password" placeholder="••••••••••••" disabled />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Transmission</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>TRANSMISSION_URL</Label>
                <Input
                  placeholder="http://localhost:9091"
                  disabled
                  value={process.env.NEXT_PUBLIC_TRANSMISSION_URL || ''}
                />
              </div>
              <div className="space-y-2">
                <Label>TRANSMISSION_USERNAME</Label>
                <Input placeholder="Optional" disabled />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Plex Authentication</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>PLEX_CLIENT_ID</Label>
                <Input placeholder="Auto-generated" disabled />
              </div>
              <div className="space-y-2">
                <Label>PLEX_SERVER_MACHINE_IDENTIFIER</Label>
                <Input placeholder="Optional - Restrict to specific server" disabled />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration Guide</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <p>Create a <code>.env</code> file in your project root with the following variables:</p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secret-key

# Radarr
RADARR_URL=http://localhost:7878
RADARR_API_KEY=your-radarr-api-key

# Sonarr
SONARR_URL=http://localhost:8989
SONARR_API_KEY=your-sonarr-api-key

# Transmission
TRANSMISSION_URL=http://localhost:9091
TRANSMISSION_USERNAME=
TRANSMISSION_PASSWORD=

# Plex (optional)
PLEX_CLIENT_ID=
PLEX_SERVER_MACHINE_IDENTIFIER=`}
          </pre>
          <p className="mt-4">
            <strong>Note:</strong> You can find your API keys in Radarr/Sonarr under Settings → General → Security.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
