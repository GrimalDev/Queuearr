import { RadarrClient, createRadarrClient } from '@/lib/api/radarr';
import { SonarrClient, createSonarrClient } from '@/lib/api/sonarr';
import { TransmissionClient, createTransmissionClient } from '@/lib/api/transmission';
import { RadarrQueueItem, SonarrQueueItem, TransmissionTorrent } from '@/types';

type QueueCacheKey = 'radarr-queue' | 'sonarr-queue' | 'transmission-state';

type TransmissionState = {
  torrents: TransmissionTorrent[];
  stats: Awaited<ReturnType<TransmissionClient['getSessionStats']>>;
};

type QueueCacheValue = {
  'radarr-queue': { records: RadarrQueueItem[] };
  'sonarr-queue': { records: SonarrQueueItem[] };
  'transmission-state': TransmissionState;
};

type CacheEntry<K extends QueueCacheKey> = {
  value?: QueueCacheValue[K];
  expiresAt: number;
  inFlight?: Promise<QueueCacheValue[K]>;
};

const DEFAULT_CACHE_TTL_MS = 15_000;
const queueCache = new Map<QueueCacheKey, CacheEntry<QueueCacheKey>>();

function getCacheTtlMs(): number {
  const raw = process.env.QUEUE_CACHE_TTL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_CACHE_TTL_MS;
  }
  return parsed;
}

async function getOrLoad<K extends QueueCacheKey>(
  key: K,
  loader: () => Promise<QueueCacheValue[K]>,
  options: { forceRefresh?: boolean } = {}
): Promise<QueueCacheValue[K]> {
  const now = Date.now();
  const current = queueCache.get(key) as CacheEntry<K> | undefined;

  if (!options.forceRefresh && current?.value && current.expiresAt > now) {
    return current.value;
  }

  if (!options.forceRefresh && current?.value) {
    if (!current.inFlight) {
      const inFlight = loader()
        .then((value) => {
          queueCache.set(key, {
            value,
            expiresAt: Date.now() + getCacheTtlMs(),
          } as CacheEntry<QueueCacheKey>);
          return value;
        })
        .catch((error: unknown) => {
          queueCache.set(key, {
            value: current.value,
            expiresAt: current.expiresAt,
          } as CacheEntry<QueueCacheKey>);
          throw error;
        });

      queueCache.set(key, {
        value: current.value,
        expiresAt: current.expiresAt,
        inFlight,
      } as CacheEntry<QueueCacheKey>);

      void inFlight.catch((error: unknown) => {
        console.error(`[queue-cache] Background refresh failed for ${key}:`, error);
      });
    }

    return current.value;
  }

  if (!options.forceRefresh && current?.inFlight) {
    return current.inFlight;
  }

  const inFlight = loader()
    .then((value) => {
      queueCache.set(key, {
        value,
        expiresAt: Date.now() + getCacheTtlMs(),
      } as CacheEntry<QueueCacheKey>);
      return value;
    })
    .catch((error: unknown) => {
      const stale = queueCache.get(key) as CacheEntry<K> | undefined;
      if (stale?.value) {
        queueCache.set(key, {
          value: stale.value,
          expiresAt: stale.expiresAt,
        } as CacheEntry<QueueCacheKey>);
      } else {
        queueCache.delete(key);
      }
      throw error;
    });

  queueCache.set(key, {
    value: current?.value,
    expiresAt: current?.expiresAt ?? 0,
    inFlight,
  } as CacheEntry<QueueCacheKey>);

  return inFlight;
}

export function invalidateQueueCache(keys?: QueueCacheKey[]): void {
  if (!keys || keys.length === 0) {
    queueCache.clear();
    return;
  }
  for (const key of keys) {
    queueCache.delete(key);
  }
}

export function getCachedRadarrQueue(radarr: RadarrClient): Promise<{ records: RadarrQueueItem[] }> {
  return getOrLoad('radarr-queue', () => radarr.getQueue(true));
}

export function getCachedSonarrQueue(sonarr: SonarrClient): Promise<{ records: SonarrQueueItem[] }> {
  return getOrLoad('sonarr-queue', () => sonarr.getQueue(true, true));
}

export function getCachedTransmissionState(transmission: TransmissionClient): Promise<TransmissionState> {
  return getOrLoad('transmission-state', async () => {
    const [torrents, stats] = await Promise.all([
      transmission.getTorrents(),
      transmission.getSessionStats(),
    ]);
    return { torrents, stats };
  });
}

export async function preloadQueueCaches(): Promise<void> {
  const radarr = createRadarrClient();
  const sonarr = createSonarrClient();
  const transmission = createTransmissionClient();

  const jobs: Array<Promise<unknown>> = [];
  const labels: Array<QueueCacheKey> = [];

  if (radarr) {
    labels.push('radarr-queue');
    jobs.push(getOrLoad('radarr-queue', () => radarr.getQueue(true), { forceRefresh: true }));
  }
  if (sonarr) {
    labels.push('sonarr-queue');
    jobs.push(getOrLoad('sonarr-queue', () => sonarr.getQueue(true, true), { forceRefresh: true }));
  }
  if (transmission) {
    labels.push('transmission-state');
    jobs.push(getOrLoad('transmission-state', async () => {
      const [torrents, stats] = await Promise.all([
        transmission.getTorrents(),
        transmission.getSessionStats(),
      ]);
      return { torrents, stats };
    }, { forceRefresh: true }));
  }

  if (jobs.length === 0) {
    return;
  }

  const results = await Promise.allSettled(jobs);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[queue-cache] Failed to preload ${labels[index]}:`, result.reason);
    }
  });
}
