export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ startWatcher }, { preloadQueueCaches }, { startInviteCleanup }, { startMovieAudioWorker }, { startDownloadSearchWorker }] = await Promise.all([
      import('@/lib/download-watcher'),
      import('@/lib/queue-cache'),
      import('@/lib/invite-cleanup'),
      import('@/lib/movie-audio-worker'),
      import('@/lib/download-search-worker'),
    ]);
    startWatcher();
    startInviteCleanup();
    startMovieAudioWorker();
    startDownloadSearchWorker();
    void preloadQueueCaches();
  }
}
