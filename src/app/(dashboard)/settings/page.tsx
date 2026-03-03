'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Check, X, Loader2, RefreshCw, Trash2, ShieldCheck, ShieldOff, Search, ChevronLeft, ChevronRight, Bell, BellOff, UserCheck, UserX, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';

interface ServiceStatus {
  name: string;
  configured: boolean;
  connected: boolean;
  error?: string;
  url?: string;
}

interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  active: boolean;
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

  const toggleActive = async (user: UserRecord) => {
    await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
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
            <div key={user.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={user.avatarUrl || undefined} alt={user.username} />
                  <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{user.username}</p>
                  {user.email && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant={user.active ? (user.role === 'admin' ? 'default' : 'secondary') : 'outline'}>
                  {!user.active ? 'pending' : user.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isSelf}
                  onClick={() => toggleActive(user)}
                  title={user.active ? 'Deactivate account' : 'Activate account'}
                  className={user.active ? '' : 'text-green-600 hover:text-green-600'}
                >
                  {user.active ? (
                    <UserX className="h-4 w-4" />
                  ) : (
                    <UserCheck className="h-4 w-4" />
                  )}
                </Button>
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function PushNotificationsManager() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported' | 'loading'>('loading');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setIsSubscribed(!!sub))
    );
  }, []);

  const subscribe = async () => {
    if (!vapidKey) return;
    setIsBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (res.ok) setIsSubscribed(true);
    } catch (err) {
      console.error('Subscribe failed:', err);
    } finally {
      setIsBusy(false);
    }
  };

  const unsubscribe = async () => {
    setIsBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
        setIsSubscribed(false);
      }
    } catch (err) {
      console.error('Unsubscribe failed:', err);
    } finally {
      setIsBusy(false);
    }
  };

  const sendTest = async () => {
    setIsBusy(true);
    setTestStatus('idle');
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Queuearr', body: 'Push notifications are working!', url: '/settings' }),
      });
      setTestStatus(res.ok ? 'sent' : 'error');
    } catch {
      setTestStatus('error');
    } finally {
      setIsBusy(false);
    }
  };

  if (permission === 'loading') {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (permission === 'unsupported') {
    return <p className="text-sm text-muted-foreground">Push notifications are not supported in this browser.</p>;
  }

  if (!vapidKey) {
    return (
      <p className="text-sm text-muted-foreground">
        VAPID keys are not configured. Set <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> and{' '}
        <code>VAPID_PRIVATE_KEY</code> in your environment.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          {isSubscribed ? (
            <Bell className="h-5 w-5 text-green-500 shrink-0" />
          ) : (
            <BellOff className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div>
            <p className="font-medium text-sm">This device</p>
            <p className="text-xs text-muted-foreground">
              {permission === 'denied'
                ? 'Notifications blocked in browser settings'
                : isSubscribed
                  ? 'Subscribed to push notifications'
                  : 'Not subscribed'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSubscribed && (
            <Button variant="outline" size="sm" onClick={sendTest} disabled={isBusy}>
              {testStatus === 'sent' ? <Check className="h-4 w-4 mr-1 text-green-500" /> : null}
              {testStatus === 'error' ? <X className="h-4 w-4 mr-1 text-destructive" /> : null}
              Test
            </Button>
          )}
          <Button
            variant={isSubscribed ? 'outline' : 'default'}
            size="sm"
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isBusy || permission === 'denied'}
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : isSubscribed ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
    </div>
  );
}
interface PlexLibrary {
  id: number;
  title: string;
  type: 'movie' | 'show';
}

interface InvitedUser {
  id: string;
  email: string;
  invitedAt: string;
}

function InviteUsersManager() {
  const [email, setEmail] = useState('');
  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  const [selectedLibraries, setSelectedLibraries] = useState<number[]>([]);
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [libsRes, invitesRes] = await Promise.all([
        fetch('/api/admin/plex/libraries'),
        fetch('/api/admin/invite')
      ]);

      if (libsRes.ok) {
        const data = await libsRes.json();
        setLibraries(data.libraries || []);
      }

      if (invitesRes.ok) {
        const data = await invitesRes.json();
        setInvitedUsers(data.invitedUsers || []);
      }
    } catch (error) {
      console.error('Failed to fetch invite data', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInvite = async () => {
    if (!email || !email.includes('@')) {
      setMessage({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }

    if (selectedLibraries.length === 0) {
      setMessage({ type: 'error', text: 'Please select at least one library.' });
      return;
    }

    setIsSending(true);
    setMessage(null);

    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, librarySectionIds: selectedLibraries }),
      });

      if (res.ok) {
        setMessage({ type: 'success', text: 'Invite sent successfully!' });
        setEmail('');
        setSelectedLibraries([]);
        fetchData();
      } else {
        const errorData = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: errorData.message || 'Failed to send invite.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An error occurred. Please try again.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleRevoke = async (userEmail: string) => {
    if (!confirm(`Are you sure you want to revoke the invite for ${userEmail}?`)) return;

    try {
      const res = await fetch(`/api/admin/invite?email=${encodeURIComponent(userEmail)}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchData();
      } else {
        console.error('Failed to revoke invite');
      }
    } catch (error) {
      console.error('Error revoking invite', error);
    }
  };

  const toggleLibrary = (id: number) => {
    setSelectedLibraries((prev) =>
      prev.includes(id) ? prev.filter((libId) => libId !== id) : [...prev, id]
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Email Address
          </label>
          <div className="flex gap-2">
            <Input
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleInvite} disabled={isSending}>
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Send Invite
            </Button>
          </div>
          {message && (
            <p className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {message.text}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium leading-none">Libraries to Share</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border rounded-lg p-3">
            {libraries.length === 0 ? (
              <p className="text-sm text-muted-foreground col-span-2 text-center py-2">
                No libraries found.
              </p>
            ) : (
              libraries.map((lib) => (
                <label
                  key={lib.id}
                  htmlFor={`lib-${lib.id}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    id={`lib-${lib.id}`}
                    checked={selectedLibraries.includes(lib.id)}
                    onCheckedChange={() => toggleLibrary(lib.id)}
                  />
                  <span className="text-sm flex-1 truncate">{lib.title}</span>
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">
                    {lib.type}
                  </Badge>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      {invitedUsers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Pending Invites</h4>
          <div className="border rounded-lg divide-y">
            {invitedUsers.map((user) => (
              <div
                key={user.id || user.email}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{user.email}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleRevoke(user.email)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



export default function SettingsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);

  const checkServices = async () => {
    setIsTesting(true);
    try {
      const [radarrRes, sonarrRes, transmissionRes, urlsRes] = await Promise.all([
        fetch('/api/radarr/queue').catch(() => null),
        fetch('/api/sonarr/queue').catch(() => null),
        fetch('/api/transmission').catch(() => null),
        fetch('/api/admin/services').catch(() => null),
      ]);

      const urls: Record<string, string | null> = urlsRes?.ok ? await urlsRes.json() : {};

      const results: ServiceStatus[] = [
        {
          name: 'Radarr',
          configured: radarrRes?.status !== 503,
          connected: radarrRes?.ok || false,
          error: radarrRes?.status === 503 ? 'Not configured' : radarrRes?.ok ? undefined : 'Connection failed',
          url: urls.Radarr ?? undefined,
        },
        {
          name: 'Sonarr',
          configured: sonarrRes?.status !== 503,
          connected: sonarrRes?.ok || false,
          error: sonarrRes?.status === 503 ? 'Not configured' : sonarrRes?.ok ? undefined : 'Connection failed',
          url: urls.Sonarr ?? undefined,
        },
        {
          name: 'Transmission',
          configured: transmissionRes?.status !== 503,
          connected: transmissionRes?.ok || false,
          error: transmissionRes?.status === 503 ? 'Not configured' : transmissionRes?.ok ? undefined : 'Connection failed',
          url: urls.Transmission ?? undefined,
        },
      ];

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
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your Queuearr instance
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite Users</CardTitle>
            <CardDescription>
              Invite new users via email and share specific Plex libraries
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteUsersManager />
          </CardContent>
        </Card>
      )}


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

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Push Notifications</CardTitle>
            <CardDescription>
              Enable push notifications on this device to receive alerts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PushNotificationsManager />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Service Status</CardTitle>
              <CardDescription>
                Check the connection status of your configured services
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={checkServices} disabled={isTesting} className="shrink-0">
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
              {services.map((service) => {
                return (
                  <div
                    key={service.name}
                    className="flex items-center justify-between gap-3 p-4 rounded-lg border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-3 w-3 rounded-full shrink-0 ${
                          service.connected
                            ? 'bg-green-500'
                            : service.configured
                              ? 'bg-yellow-500'
                              : 'bg-gray-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{service.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {service.error ?? service.url ?? '—'}
                        </p>
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
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
