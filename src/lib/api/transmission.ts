import { Transmission } from '@ctrl/transmission';
import { TransmissionTorrent, TransmissionStatus, TransmissionErrorType } from '@/types';

interface TransmissionConfig {
  baseUrl: string;
  username?: string;
  password?: string;
}

interface TorrentFields {
  id: number;
  hashString: string;
  name: string;
  status: number;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  sizeWhenDone: number;
  leftUntilDone: number;
  totalSize: number;
  downloadedEver: number;
  uploadedEver: number;
  uploadRatio: number;
  isStalled: boolean;
  isFinished: boolean;
  error: number;
  errorString: string;
  peersConnected: number;
  peersSendingToUs: number;
  peersGettingFromUs: number;
  addedDate: number;
  doneDate: number;
  activityDate: number;
  queuePosition: number;
  downloadDir: string;
}

export class TransmissionClient {
  private client: Transmission;

  constructor(config: TransmissionConfig) {
    this.client = new Transmission({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
    });
  }

  async getTorrents(): Promise<TransmissionTorrent[]> {
    const response = await this.client.listTorrents(undefined, [
      'id',
      'hashString',
      'name',
      'status',
      'percentDone',
      'rateDownload',
      'rateUpload',
      'eta',
      'sizeWhenDone',
      'leftUntilDone',
      'totalSize',
      'downloadedEver',
      'uploadedEver',
      'uploadRatio',
      'isStalled',
      'isFinished',
      'error',
      'errorString',
      'peersConnected',
      'peersSendingToUs',
      'peersGettingFromUs',
      'addedDate',
      'doneDate',
      'activityDate',
      'queuePosition',
      'downloadDir',
    ]);

    return (response.arguments.torrents as TorrentFields[]).map((t) => ({
      id: t.id,
      hashString: t.hashString,
      name: t.name,
      status: t.status as TransmissionStatus,
      percentDone: t.percentDone,
      rateDownload: t.rateDownload,
      rateUpload: t.rateUpload,
      eta: t.eta,
      sizeWhenDone: t.sizeWhenDone,
      leftUntilDone: t.leftUntilDone,
      totalSize: t.totalSize,
      downloadedEver: t.downloadedEver,
      uploadedEver: t.uploadedEver,
      uploadRatio: t.uploadRatio,
      isStalled: t.isStalled,
      isFinished: t.isFinished,
      error: t.error as TransmissionErrorType,
      errorString: t.errorString,
      peersConnected: t.peersConnected,
      peersSendingToUs: t.peersSendingToUs,
      peersGettingFromUs: t.peersGettingFromUs,
      addedDate: t.addedDate,
      doneDate: t.doneDate,
      activityDate: t.activityDate,
      queuePosition: t.queuePosition,
      downloadDir: t.downloadDir,
    }));
  }

  async getTorrent(hashOrId: string | number): Promise<TransmissionTorrent | undefined> {
    const torrents = await this.getTorrents();
    if (typeof hashOrId === 'number') {
      return torrents.find((t) => t.id === hashOrId);
    }
    return torrents.find((t) => t.hashString === hashOrId);
  }

  async pauseTorrent(hashOrId: string | number): Promise<void> {
    await this.client.pauseTorrent(hashOrId);
  }

  async resumeTorrent(hashOrId: string | number): Promise<void> {
    await this.client.resumeTorrent(hashOrId);
  }

  async removeTorrent(hashOrId: string | number, deleteLocalData = false): Promise<void> {
    await this.client.removeTorrent(hashOrId, deleteLocalData);
  }

  async getSessionStats(): Promise<{
    downloadSpeed: number;
    uploadSpeed: number;
    activeTorrentCount: number;
    pausedTorrentCount: number;
    torrentCount: number;
    downloadQueueSize: number;
    downloadQueueEnabled: boolean;
    seedQueueSize: number;
    seedQueueEnabled: boolean;
  }> {
    const [allData, session] = await Promise.all([
      this.client.getAllData(),
      this.client.getSession(),
    ]);
    const torrents = allData.torrents || [];
    
    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let activeTorrentCount = 0;
    let pausedTorrentCount = 0;

    for (const t of torrents) {
      downloadSpeed += t.downloadSpeed || 0;
      uploadSpeed += t.uploadSpeed || 0;
      if (t.state === 'downloading' || t.state === 'seeding') {
        activeTorrentCount++;
      } else if (t.state === 'paused') {
        pausedTorrentCount++;
      }
    }

    const sessionArgs = session.arguments as unknown as Record<string, unknown>;

    return {
      downloadSpeed,
      uploadSpeed,
      activeTorrentCount,
      pausedTorrentCount,
      torrentCount: torrents.length,
      downloadQueueSize: (sessionArgs['download-queue-size'] as number) ?? 5,
      downloadQueueEnabled: (sessionArgs['download-queue-enabled'] as boolean) ?? false,
      seedQueueSize: (sessionArgs['seed-queue-size'] as number) ?? 5,
      seedQueueEnabled: (sessionArgs['seed-queue-enabled'] as boolean) ?? false,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.getSession();
      return true;
    } catch {
      return false;
    }
  }

  getStatusString(status: TransmissionStatus): string {
    const statusMap: Record<TransmissionStatus, string> = {
      [TransmissionStatus.STOPPED]: 'stopped',
      [TransmissionStatus.CHECK_WAIT]: 'check-waiting',
      [TransmissionStatus.CHECK]: 'checking',
      [TransmissionStatus.DOWNLOAD_WAIT]: 'download-waiting',
      [TransmissionStatus.DOWNLOAD]: 'downloading',
      [TransmissionStatus.SEED_WAIT]: 'seed-waiting',
      [TransmissionStatus.SEED]: 'seeding',
    };
    return statusMap[status] || 'unknown';
  }

  isProblematic(
    torrent: TransmissionTorrent,
    queueSettings?: { downloadQueueEnabled: boolean; downloadQueueSize: number }
  ): {
    isProblematic: boolean;
    reason?: string;
  } {
    if (torrent.error > 0) {
      return { isProblematic: true, reason: torrent.errorString || 'Unknown error' };
    }

    const isQueuedOrWaiting =
      torrent.status === TransmissionStatus.DOWNLOAD_WAIT ||
      torrent.status === TransmissionStatus.SEED_WAIT ||
      torrent.status === TransmissionStatus.CHECK_WAIT;

    if (isQueuedOrWaiting) {
      return { isProblematic: false };
    }

    if (torrent.isStalled && torrent.status === TransmissionStatus.DOWNLOAD) {
      const hasBeenDownloadingAWhile = Date.now() / 1000 - torrent.activityDate > 30;
      if (hasBeenDownloadingAWhile) {
        return { isProblematic: true, reason: 'Torrent is stalled' };
      }
    }

    if (
      torrent.status === TransmissionStatus.DOWNLOAD &&
      torrent.rateDownload === 0 &&
      torrent.peersSendingToUs === 0 &&
      torrent.leftUntilDone > 0
    ) {
      const timeSinceActivity = Date.now() / 1000 - torrent.activityDate;
      if (timeSinceActivity > 30) {
        return { isProblematic: true, reason: 'No active peers sending data' };
      }
    }

    return { isProblematic: false };
  }
}

export function createTransmissionClient(): TransmissionClient | null {
  const baseUrl = process.env.TRANSMISSION_URL;

  if (!baseUrl) {
    return null;
  }

  return new TransmissionClient({
    baseUrl,
    username: process.env.TRANSMISSION_USERNAME,
    password: process.env.TRANSMISSION_PASSWORD,
  });
}
