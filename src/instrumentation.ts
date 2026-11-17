export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ startWatcher }, { preloadQueueCaches }, { startInviteCleanup }, { startMovieAudioWorker }, { startDownloadSearchWorker }, { startAudioProfileCleanup }, { startAutomaticDownloadRetries }, { startDownloadMediaChecks }] = await Promise.all([
      import('@/lib/download-watcher'),
      import('@/lib/queue-cache'),
      import('@/lib/invite-cleanup'),
      import('@/lib/movie-audio-worker'),
      import('@/lib/download-search-worker'),
      import('@/lib/audio-profile-cleanup'),
      import('@/lib/automatic-download-retry'),
      import('@/lib/download-media-worker'),
    ]);
    startWatcher();
    startInviteCleanup();
    startMovieAudioWorker();
    startDownloadSearchWorker();
    startAudioProfileCleanup();
    startAutomaticDownloadRetries();
    startDownloadMediaChecks();
    void preloadQueueCaches();
  }
}
