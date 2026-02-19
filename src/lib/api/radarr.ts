import axios, { AxiosInstance } from 'axios';
import {
  RadarrMovie,
  RadarrQueueItem,
  RadarrQualityProfile,
  RadarrRootFolder,
} from '@/types';

interface RadarrConfig {
  baseUrl: string;
  apiKey: string;
}

export class RadarrClient {
  private client: AxiosInstance;

  constructor(config: RadarrConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
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
    options: { blocklist?: boolean } = {}
  ): Promise<void> {
    await this.client.delete('/api/v3/queue/bulk', {
      params: {
        removeFromClient: true,
        blocklist: options.blocklist ?? false,
        skipRedownload: false,
        changeCategory: false,
      },
      data: { ids },
    });
  }

  async triggerSearch(movieIds: number[]): Promise<void> {
    await this.client.post('/api/v3/command', { name: 'MoviesSearch', movieIds });
  }

  async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    const response = await this.client.get<RadarrQualityProfile[]>('/api/v3/qualityprofile');
    return response.data;
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
