import axios, { AxiosInstance } from 'axios';
import {
  SonarrSeries,
  SonarrQueueItem,
  SonarrQualityProfile,
  SonarrLanguageProfile,
  SonarrRootFolder,
} from '@/types';

interface SonarrConfig {
  baseUrl: string;
  apiKey: string;
}

export class SonarrClient {
  private client: AxiosInstance;

  constructor(config: SonarrConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async searchSeries(query: string): Promise<SonarrSeries[]> {
    const response = await this.client.get<SonarrSeries[]>('/api/v3/series/lookup', {
      params: { term: query },
    });
    return response.data;
  }

  async searchByTvdbId(tvdbId: number): Promise<SonarrSeries[]> {
    const response = await this.client.get<SonarrSeries[]>('/api/v3/series/lookup', {
      params: { term: `tvdb:${tvdbId}` },
    });
    return response.data;
  }

  async getSeries(): Promise<SonarrSeries[]> {
    const response = await this.client.get<SonarrSeries[]>('/api/v3/series');
    return response.data;
  }

  async getSeriesById(id: number): Promise<SonarrSeries> {
    const response = await this.client.get<SonarrSeries>(`/api/v3/series/${id}`);
    return response.data;
  }

  async addSeries(series: {
    title: string;
    tvdbId: number;
    qualityProfileId: number;
    languageProfileId?: number;
    rootFolderPath: string;
    seasonFolder?: boolean;
    monitored?: boolean;
    monitorOption?: 'all' | 'future' | 'missing' | 'existing' | 'firstSeason' | 'latestSeason' | 'pilot' | 'none';
    searchForMissingEpisodes?: boolean;
  }): Promise<SonarrSeries> {
    const response = await this.client.post<SonarrSeries>('/api/v3/series', {
      title: series.title,
      tvdbId: series.tvdbId,
      qualityProfileId: series.qualityProfileId,
      languageProfileId: series.languageProfileId,
      rootFolderPath: series.rootFolderPath,
      seasonFolder: series.seasonFolder ?? true,
      monitored: series.monitored ?? true,
      addOptions: {
        monitor: series.monitorOption || 'all',
        searchForMissingEpisodes: series.searchForMissingEpisodes ?? true,
        searchForCutoffUnmetEpisodes: false,
      },
    });
    return response.data;
  }

  async deleteSeries(id: number, deleteFiles = false): Promise<void> {
    await this.client.delete(`/api/v3/series/${id}`, {
      params: { deleteFiles },
    });
  }

  async getQueue(includeSeries = true, includeEpisode = true): Promise<{ records: SonarrQueueItem[] }> {
    const response = await this.client.get<{ records: SonarrQueueItem[] }>('/api/v3/queue', {
      params: { includeSeries, includeEpisode, pageSize: 1000 },
    });
    return response.data;
  }

  async deleteQueueItem(
    id: number,
    options: { removeFromClient?: boolean; blocklist?: boolean } = {}
  ): Promise<void> {
    await this.client.delete(`/api/v3/queue/${id}`, {
      params: {
        removeFromClient: options.removeFromClient ?? true,
        blocklist: options.blocklist ?? false,
      },
    });
  }

  async deleteQueueItemBulk(ids: number[]): Promise<void> {
    await this.client.delete('/api/v3/queue/bulk', {
      params: {
        removeFromClient: true,
        blocklist: false,
        skipRedownload: false,
        changeCategory: false,
      },
      data: { ids },
    });
  }

  async getQualityProfiles(): Promise<SonarrQualityProfile[]> {
    const response = await this.client.get<SonarrQualityProfile[]>('/api/v3/qualityprofile');
    return response.data;
  }

  async getLanguageProfiles(): Promise<SonarrLanguageProfile[]> {
    const response = await this.client.get<SonarrLanguageProfile[]>('/api/v3/languageprofile');
    return response.data;
  }

  async getRootFolders(): Promise<SonarrRootFolder[]> {
    const response = await this.client.get<SonarrRootFolder[]>('/api/v3/rootfolder');
    return response.data;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/api/v3/health');
      return true;
    } catch {
      return false;
    }
  }
}

export function createSonarrClient(): SonarrClient | null {
  const baseUrl = process.env.SONARR_URL;
  const apiKey = process.env.SONARR_API_KEY;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return new SonarrClient({ baseUrl, apiKey });
}
