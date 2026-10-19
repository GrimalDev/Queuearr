import axios, { AxiosInstance } from 'axios';
import { createHttpsAgentForService } from '@/lib/api/tls';
import {
  RadarrMovie,
  RadarrQueueItem,
  RadarrQualityProfile,
  RadarrRootFolder,
  RadarrCustomFormat,
  Release,
  DownloadGrabHistory,
  MediaQuality,
} from '@/types';

interface RadarrConfig {
  baseUrl: string;
  apiKey: string;
}

export class RadarrClient {
  private client: AxiosInstance;

  constructor(config: RadarrConfig) {
    const httpsAgent = createHttpsAgentForService('radarr');
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      ...(httpsAgent ? { httpsAgent } : {}),
    });
  }

  async searchMovies(query: string): Promise<RadarrMovie[]> {
    const response = await this.client.get<RadarrMovie[]>('/api/v3/movie/lookup', {
      params: { term: query },
    });
    return response.data;
  }

  async searchByTmdbId(tmdbId: number): Promise<RadarrMovie | undefined> {
    const response = await this.client.get<RadarrMovie>('/api/v3/movie/lookup/tmdb', {
      params: { tmdbId },
    });
    return response.data;
  }

  async getMovies(): Promise<RadarrMovie[]> {
    const response = await this.client.get<RadarrMovie[]>('/api/v3/movie');
    return response.data;
  }

  async getMovie(id: number): Promise<RadarrMovie> {
    const response = await this.client.get<RadarrMovie>(`/api/v3/movie/${id}`);
    return response.data;
  }

  async getGrabHistory(downloadId: string): Promise<DownloadGrabHistory[]> {
    const response = await this.client.get<{ records: DownloadGrabHistory[] }>('/api/v3/history', {
      params: { downloadId: downloadId.toUpperCase(), eventType: 1, page: 1, pageSize: 10, sortKey: 'date', sortDirection: 'descending' },
    });
    return response.data.records;
  }

  async updateMovie(movie: RadarrMovie): Promise<RadarrMovie> {
    const response = await this.client.put<RadarrMovie>(`/api/v3/movie/${movie.id}`, movie);
    return response.data;
  }

  async updateMovieFileQuality(id: number, expectedPath: string, quality: MediaQuality): Promise<boolean> {
    const { data: file } = await this.client.get<NonNullable<RadarrMovie['movieFile']>>(`/api/v3/moviefile/${id}`);
    if (file.id !== id || file.path !== expectedPath) return false;
    // Preserve analyzed languages, edition and flags from the current full resource.
    await this.client.put(`/api/v3/moviefile/${id}`, { ...file, quality });
    return true;
  }

  async getCustomFormats(): Promise<RadarrCustomFormat[]> {
    const response = await this.client.get<RadarrCustomFormat[]>('/api/v3/customformat');
    return response.data;
  }

  async getAudioDonorIsolationIssue(): Promise<string | null> {
    const response = await this.client.get<{ id: number; enable: boolean; implementation: string; fields: { name: string; value?: unknown }[] }[]>('/api/v3/downloadclient');
    const clients = response.data.filter((client) => client.enable && client.implementation === 'Transmission');
    if (!clients.length) return 'Radarr has no enabled Transmission download client. Configure one before requesting additional audio.';
    for (const client of clients) {
      const category = client.fields.find((field) => field.name === 'movieCategory')?.value;
      const directory = client.fields.find((field) => field.name === 'movieDirectory')?.value;
      const context = `Radarr Transmission client ${client.id}`;
      if (typeof category !== 'string' || !category.trim()) {
        return `${context} has an empty Category. Set Category to radarr and leave Directory empty.`;
      }
      if (category.trim().toLowerCase().startsWith('queuearr-audio')) {
        return `${context} uses the reserved queuearr-audio category. Set a separate Category such as radarr.`;
      }
      if (directory !== undefined && directory !== null && (typeof directory !== 'string' || directory.trim())) {
        return `${context} has a Directory override. Clear Directory and use Category instead so Radarr cannot import Queuearr audio donors.`;
      }
    }
    return null;
  }

  async createCustomFormat(format: Omit<RadarrCustomFormat, 'id'>): Promise<RadarrCustomFormat> {
    const response = await this.client.post<RadarrCustomFormat>('/api/v3/customformat', format);
    return response.data;
  }

  async createQualityProfile(profile: Omit<RadarrQualityProfile, 'id'>): Promise<RadarrQualityProfile> {
    const response = await this.client.post<RadarrQualityProfile>('/api/v3/qualityprofile', profile);
    return response.data;
  }

  async addMovie(movie: {
    title: string;
    tmdbId: number;
    year: number;
    qualityProfileId: number;
    rootFolderPath: string;
    minimumAvailability?: 'announced' | 'inCinemas' | 'released' | 'preDB';
    monitored?: boolean;
    searchForMovie?: boolean;
  }): Promise<RadarrMovie> {
    const response = await this.client.post<RadarrMovie>('/api/v3/movie', {
      title: movie.title,
      tmdbId: movie.tmdbId,
      year: movie.year,
      qualityProfileId: movie.qualityProfileId,
      rootFolderPath: movie.rootFolderPath,
      minimumAvailability: movie.minimumAvailability || 'released',
      monitored: movie.monitored ?? true,
      addOptions: {
        searchForMovie: movie.searchForMovie ?? true,
      },
    });
    return response.data;
  }

  async deleteMovie(id: number, deleteFiles = false): Promise<void> {
    await this.client.delete(`/api/v3/movie/${id}`, {
      params: { deleteFiles },
    });
  }

  async getQueue(includeMovie = true): Promise<{ records: RadarrQueueItem[] }> {
    const response = await this.client.get<{ records: RadarrQueueItem[] }>('/api/v3/queue', {
      params: { includeMovie, pageSize: 1000 },
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

  async deleteQueueItemBulk(
    ids: number[],
    options: { blocklist?: boolean; skipRedownload?: boolean } = {}
  ): Promise<void> {
    await this.client.delete('/api/v3/queue/bulk', {
      params: {
        removeFromClient: true,
        blocklist: options.blocklist ?? false,
        skipRedownload: options.skipRedownload ?? false,
        changeCategory: false,
      },
      data: { ids },
    });
  }

  async triggerSearch(movieIds: number[]): Promise<void> {
    await this.client.post('/api/v3/command', { name: 'MoviesSearch', movieIds });
  }

  async hasActiveMovieSearch(movieId: number): Promise<boolean> {
    const response = await this.client.get<{
      name: string; status: string; body?: { movieIds?: number[] };
    }[]>('/api/v3/command');
    return response.data.some((command) => command.name === 'MoviesSearch' &&
      ['queued', 'started'].includes(command.status) && command.body?.movieIds?.includes(movieId));
  }

  async rescanMovie(movieId: number): Promise<void> {
    await this.client.post('/api/v3/command', { name: 'RescanMovie', movieId });
  }

  async getReleases(movieId: number): Promise<Release[]> {
    const response = await this.client.get<Release[]>('/api/v3/release', {
      params: { movieId },
      timeout: 60_000,
    });
    return response.data;
  }

  async grabRelease(guid: string, indexerId: number): Promise<void> {
    await this.client.post('/api/v3/release', { guid, indexerId });
  }

  async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    const response = await this.client.get<RadarrQualityProfile[]>('/api/v3/qualityprofile');
    return response.data;
  }

  async getQualityProfile(id: number): Promise<RadarrQualityProfile> {
    const response = await this.client.get<RadarrQualityProfile>(`/api/v3/qualityprofile/${id}`);
    return response.data;
  }

  async deleteQualityProfile(id: number): Promise<void> {
    await this.client.delete(`/api/v3/qualityprofile/${id}`);
  }

  async getRootFolders(): Promise<RadarrRootFolder[]> {
    const response = await this.client.get<RadarrRootFolder[]>('/api/v3/rootfolder');
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

export function createRadarrClient(): RadarrClient | null {
  const baseUrl = process.env.RADARR_URL;
  const apiKey = process.env.RADARR_API_KEY;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return new RadarrClient({ baseUrl, apiKey });
}
