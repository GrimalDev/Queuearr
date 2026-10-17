import axios, { AxiosInstance } from 'axios';
import { TransmissionTorrent, TransmissionStatus, TransmissionErrorType } from '@/types';
import { createHttpsAgentForService } from '@/lib/api/tls';

interface TransmissionConfig {
  baseUrl: string;
  username?: string;
  password?: string;
}

function normalizeTransmissionUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, '');

    if (path === '/transmission/rpc') {
      url.pathname = '/';
      return url.toString();
    }

    if (path === '/transmission') {
      url.pathname = '/';
      return url.toString();
    }

    url.pathname = path === '' ? '/' : `${path}/`;
    return url.toString();
  } catch {
    return baseUrl;
  }
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

function isTorrentFields(value: unknown): value is TorrentFields {
  if (!value || typeof value !== 'object') return false;
  const torrent = value as Partial<TorrentFields>;
  return (
    typeof torrent.id === 'number' &&
    typeof torrent.hashString === 'string' &&
    typeof torrent.name === 'string' &&
    typeof torrent.status === 'number'
  );
}

function toTransmissionTorrent(t: TorrentFields): TransmissionTorrent {
  return {
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
  };
}

export class TransmissionClient {
  private rpcClient: AxiosInstance;
  private baseUrl: string;
  private sessionId?: string;
  private username?: string;
  private password?: string;

  constructor(config: TransmissionConfig) {
    this.baseUrl = normalizeTransmissionUrl(config.baseUrl);
    this.username = config.username;
    this.password = config.password;
    const httpsAgent = createHttpsAgentForService('transmission');
    this.rpcClient = axios.create({
      baseURL: this.buildRpcUrl(),
      timeout: 10000,
      ...(httpsAgent ? { httpsAgent } : {}),
      validateStatus: () => true,
    });
  }

  private buildRpcUrl(): string {
    try {
      return new URL('/transmission/rpc', this.baseUrl).toString();
    } catch {
      return `${this.baseUrl.replace(/\/+$/, '')}/transmission/rpc`;
    }
  }

  private buildAuthHeader(): string | undefined {
    if (!this.username && !this.password) return undefined;
    const str = `${this.username ?? ''}:${this.password ?? ''}`;
    return `Basic ${Buffer.from(str).toString('base64')}`;
  }

  private async rpcRequest<T>(
    method: string,
    args: Record<string, unknown> = {},
    retrySession = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionId) headers['X-Transmission-Session-Id'] = this.sessionId;
    const authHeader = this.buildAuthHeader();
    if (authHeader) headers.Authorization = authHeader;

    const response = await this.rpcClient.post<{
      result?: string;
      arguments?: T;
    }>('', {
      method,
      arguments: args,
    }, {
      headers,
    });

    if (response.status === 409) {
      if (!retrySession) throw new Error('Transmission rejected the refreshed session id');
      const nextSessionIdHeader = response.headers['x-transmission-session-id'];
      const nextSessionId = Array.isArray(nextSessionIdHeader)
        ? nextSessionIdHeader[0]
        : nextSessionIdHeader;
      if (!nextSessionId) {
        throw new Error('Transmission session id missing from 409 response');
      }
      this.sessionId = nextSessionId;
      return this.rpcRequest<T>(method, args, false);
    }

    if (response.status < 200 || response.status >= 300) {
      const text = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
      throw new Error(`Transmission RPC failed (${response.status}): ${text || response.statusText}`);
    }

    const json = response.data;
    if (json.result && json.result !== 'success') {
      throw new Error(`Transmission RPC error: ${json.result}`);
    }

    return json as T;
  }

  private async listTorrents(fields: string[]): Promise<TorrentFields[]> {
    const data = await this.rpcRequest<{ arguments?: { torrents?: TorrentFields[] } }>('torrent-get', {
      fields,
    });
    const torrents = data?.arguments?.torrents;
    if (!Array.isArray(torrents)) {
      throw new Error('Transmission response missing torrents list');
    }
    return torrents;
  }

  async getTorrents(): Promise<TransmissionTorrent[]> {
    const torrents = await this.listTorrents([
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
    return torrents.filter(isTorrentFields).map(toTransmissionTorrent);
  }

  async getTorrent(hashOrId: string | number): Promise<TransmissionTorrent | undefined> {
    const torrents = await this.getTorrents();
    if (typeof hashOrId === 'number') {
      return torrents.find((t) => t.id === hashOrId);
    }
    return torrents.find((t) => t.hashString === hashOrId);
  }

  async pauseTorrent(hashOrId: string | number): Promise<void> {
    await this.rpcRequest('torrent-stop', { ids: [hashOrId] });
  }

  async resumeTorrent(hashOrId: string | number): Promise<void> {
    await this.rpcRequest('torrent-start', { ids: [hashOrId] });
  }

  async removeTorrent(hashOrId: string | number, deleteLocalData = false): Promise<void> {
    await this.rpcRequest('torrent-remove', { ids: [hashOrId], 'delete-local-data': deleteLocalData });
  }

  async queueTorrentTop(hashOrId: string | number): Promise<void> {
    await this.rpcRequest('queue-move-top', { ids: [hashOrId] });
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
    const [torrents, session] = await Promise.all([
      this.listTorrents(['rateDownload', 'rateUpload', 'status']),
      this.rpcRequest<{ arguments?: Record<string, unknown> }>('session-get'),
    ]);
    const sessionArgs = session.arguments ?? {};

    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let activeTorrentCount = 0;
    let pausedTorrentCount = 0;

    for (const t of torrents) {
      downloadSpeed += t.rateDownload || 0;
      uploadSpeed += t.rateUpload || 0;
      if (t.status === TransmissionStatus.DOWNLOAD || t.status === TransmissionStatus.SEED) {
        activeTorrentCount++;
      } else if (t.status === TransmissionStatus.STOPPED) {
        pausedTorrentCount++;
      }
    }

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
      await this.rpcRequest('session-get');
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
    torrent: TransmissionTorrent
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

    const referenceDate = torrent.activityDate > 0 ? torrent.activityDate : torrent.addedDate;

    if (torrent.isStalled && torrent.status === TransmissionStatus.DOWNLOAD) {
      const hasBeenDownloadingAWhile = Date.now() / 1000 - referenceDate > 30;
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
      const timeSinceActivity = Date.now() / 1000 - referenceDate;
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
