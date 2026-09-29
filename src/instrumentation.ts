export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ startWatcher }, { preloadQueueCaches }, { startInviteCleanup }] = await Promise.all([
      import('@/lib/download-watcher'),
      import('@/lib/queue-cache'),
      import('@/lib/invite-cleanup'),
    ]);
    startWatcher();
    startInviteCleanup();
    void preloadQueueCaches();
  }
}
