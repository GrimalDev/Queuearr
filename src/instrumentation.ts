export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ startWatcher }, { preloadQueueCaches }] = await Promise.all([
      import('@/lib/download-watcher'),
      import('@/lib/queue-cache'),
    ]);
    startWatcher();
    void preloadQueueCaches();
  }
}
