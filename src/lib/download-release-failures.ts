import type { RadarrClient } from '@/lib/api/radarr';
import type { SonarrClient } from '@/lib/api/sonarr';
import { createTransmissionClient } from '@/lib/api/transmission';
import { getDownloadFileFailureReason, isLocalStorageFailure } from '@/lib/automatic-retry-policy';
import { recordDownloadReleaseFailure } from '@/lib/db/download-release-attempts';
import { releaseGuidIdentity, releaseHash, releaseTitleDigest } from '@/lib/download-release-rounds';
import type { RadarrQueueItem, SonarrQueueItem } from '@/types';
import type { MonitoredDownload } from '@/lib/db/schema';

/** Record only positive evidence of a temporary failure; unknown/manual blocks never recycle. */
export async function rejectDownloadSources(
  download: MonitoredDownload, round: number, items: (RadarrQueueItem | SonarrQueueItem)[],
  client: RadarrClient | SonarrClient, remove: () => Promise<void>,
): Promise<void> {
  const before = await client.getBlocklist(download.mediaId).catch(() => null);
  const transmission = createTransmissionClient();
  const torrents = transmission ? await transmission.getTorrents().catch(() => []) : [];
  const groups = new Map<string, (RadarrQueueItem | SonarrQueueItem)[]>();
  for (const item of items) {
    const key = releaseHash(item.downloadId) ?? releaseTitleDigest(item.title);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const failures = [];
  for (const group of groups.values()) {
    const first = group[0];
    const hash = releaseHash(first.downloadId);
    const history = hash ? await client.getGrabHistory(hash).catch(() => []) : [];
    const grab = history.find((entry) => releaseHash(entry.downloadId) === hash && !!entry.data?.guid);
    const title = grab?.sourceTitle || first.title;
    const identities = [...(hash ? [`hash:${hash}`] : []), ...(grab?.data?.guid ? [releaseGuidIdentity(grab.data.guid)] : [])];
    if (!identities.length) identities.push(`title:${releaseTitleDigest(title)}`);
    const messages = group.flatMap((item) => [item.errorMessage, ...(item.statusMessages ?? []).flatMap((status) => status.messages)]).filter(Boolean).join('\n');
    const torrent = hash ? torrents.find((item) => item.hashString.toLowerCase() === hash) : undefined;
    const badFile = group.some((item) => !!getDownloadFileFailureReason(item));
    const temporary = !badFile && !group.some(isLocalStorageFailure) && (
      /\b(?:stalled|no (?:peers|seeders)|timed? out|timeout|connection (?:reset|refused)|tracker[^\n]*unreachable)\b/i.test(messages) ||
      !!torrent && torrent.percentDone < 1 && torrent.isStalled && Date.now() - torrent.addedDate * 1000 >= 5 * 60_000);
    const kind = badFile ? 'permanent' as const : temporary ? 'temporary' as const : 'unknown' as const;
    const failure = { identities, title, kind, indexer: grab?.data?.indexer || first.indexer };
    failures.push(failure);
    recordDownloadReleaseFailure(download.id, download.createdAt, round, identities, title, kind);
  }
  await remove();
  // Record newly created entries only. Existing entries may have been manually blocked elsewhere.
  const after = before ? await client.getBlocklist(download.mediaId).catch(() => null) : null;
  if (!before || !after) return;
  const priorIds = new Set(before.map((entry) => entry.id));
  for (const failure of failures) {
    const created = after.filter((entry) => !priorIds.has(entry.id) && releaseTitleDigest(entry.sourceTitle) === releaseTitleDigest(failure.title) &&
      (!failure.indexer || entry.indexer === failure.indexer));
    // Ambiguous concurrent changes cannot grant a blocklist override.
    const owned = created.length === 1 ? [created[0].id] : [];
    recordDownloadReleaseFailure(download.id, download.createdAt, round, failure.identities, failure.title, failure.kind, owned);
  }
}
