import { createRadarrClient } from '@/lib/api/radarr';
import { createSonarrClient } from '@/lib/api/sonarr';
import type { Release } from '@/types';

interface SmartGrabOptions {
  source: 'radarr' | 'sonarr';
  /** Radarr movieId or Sonarr seriesId */
  mediaId: number;
  /** Sonarr episodeId — required for episode-level grab; falls back to series search if absent */
  episodeId?: number;
}

/**
 * Queries indexers via Radarr/Sonarr, sorts results by seeders descending,
 * and grabs the best non-rejected release.
 *
 * Falls back to the standard trigger-search command when no releases are found
 * (indexers offline, nothing indexed yet, etc.).
 */
export async function smartGrab({ source, mediaId, episodeId }: SmartGrabOptions): Promise<void> {
  if (source === 'radarr') {
    const client = createRadarrClient();
    if (!client) throw new Error('Radarr not configured');

    const releases = await client.getReleases(mediaId);
    const best = pickBest(releases);

    if (best) {
      console.log(`[smart-grab] radarr movieId=${mediaId} → "${best.title}" (${best.seeders ?? 0} seeders)`);
      await client.grabRelease(best.guid, best.indexerId);
    } else {
      console.log(`[smart-grab] radarr movieId=${mediaId} → no eligible releases, falling back to trigger search`);
      await client.triggerSearch([mediaId]);
    }
    return;
  }

  // Sonarr
  const client = createSonarrClient();
  if (!client) throw new Error('Sonarr not configured');

  if (episodeId) {
    const releases = await client.getReleases(episodeId);
    const best = pickBest(releases);

    if (best) {
      console.log(`[smart-grab] sonarr episodeId=${episodeId} → "${best.title}" (${best.seeders ?? 0} seeders)`);
      await client.grabRelease(best.guid, best.indexerId);
    } else {
      console.log(`[smart-grab] sonarr episodeId=${episodeId} → no eligible releases, falling back to episode search`);
      await client.triggerEpisodeSearch([episodeId]);
    }
  } else {
    // No episodeId (series-level retry) — can't do a release search without one
    console.log(`[smart-grab] sonarr seriesId=${mediaId} → no episodeId, falling back to series search`);
    await client.triggerSearch(mediaId);
  }
}

function pickBest(releases: Release[]): Release | null {
  const eligible = releases.filter((r) => !r.rejections?.length && r.downloadAllowed !== false);

  // Sort by Radarr/Sonarr's own quality score (qualityWeight + customFormatScore),
  // take the top 5, then pick the one with the biggest peer swarm.
  const top5ByScore = eligible
    .sort((a, b) =>
      ((b.qualityWeight ?? 0) + (b.customFormatScore ?? 0)) -
      ((a.qualityWeight ?? 0) + (a.customFormatScore ?? 0))
    )
    .slice(0, 5);

  return top5ByScore.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))[0] ?? null;
}
