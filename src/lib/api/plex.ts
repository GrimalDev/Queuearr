import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { PlexPin, PlexUser, PlexServer } from '@/types';

const PLEX_API_URL = 'https://plex.tv/api/v2';

interface PlexHeaders {
  [key: string]: string | undefined;
  Accept: string;
  'X-Plex-Product': string;
  'X-Plex-Version': string;
  'X-Plex-Client-Identifier': string;
  'X-Plex-Platform': string;
  'X-Plex-Platform-Version': string;
  'X-Plex-Device': string;
  'X-Plex-Device-Name': string;
  'X-Plex-Token'?: string;
}

export class PlexAuthClient {
  private headers: PlexHeaders;
  private clientId: string;

  constructor(clientId?: string) {
    this.clientId = clientId || this.getOrCreateClientId();
    this.headers = {
      Accept: 'application/json',
      'X-Plex-Product': 'Queuearr',
      'X-Plex-Version': '1.0.0',
      'X-Plex-Client-Identifier': this.clientId,
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': '1.0.0',
      'X-Plex-Device': 'Browser',
      'X-Plex-Device-Name': 'Queuearr Web App',
    };
  }

  private getOrCreateClientId(): string {
    if (typeof window !== 'undefined') {
      let clientId = localStorage.getItem('plex-client-id');
      if (!clientId) {
        clientId = uuidv4();
        localStorage.setItem('plex-client-id', clientId);
      }
      return clientId;
    }
    return uuidv4();
  }

  async createPin(): Promise<PlexPin> {
    const response = await axios.post<PlexPin>(
      `${PLEX_API_URL}/pins`,
      { strong: true },
      { headers: this.headers }
    );
    return response.data;
  }

  getAuthUrl(pin: PlexPin): string {
    const params = new URLSearchParams({
      clientID: this.clientId,
      code: pin.code,
      'context[device][product]': 'Queuearr',
      'context[device][version]': '1.0.0',
      'context[device][platform]': 'Web',
      'context[device][platformVersion]': '1.0.0',
      'context[device][device]': 'Browser',
      'context[device][deviceName]': 'Queuearr Web App',
      forwardUrl: typeof window !== 'undefined' ? `${window.location.origin}/auth/plex/callback` : '',
    });

    return `https://app.plex.tv/auth#?${params.toString()}`;
  }

  async checkPin(pinId: number): Promise<PlexPin> {
    const response = await axios.get<PlexPin>(`${PLEX_API_URL}/pins/${pinId}`, {
      headers: this.headers,
    });
    return response.data;
  }

  async getUser(authToken: string): Promise<PlexUser> {
    const response = await axios.get<PlexUser>(`${PLEX_API_URL}/user`, {
      headers: {
        ...this.headers,
        'X-Plex-Token': authToken,
      },
    });
    return {
      ...response.data,
      authToken,
    };
  }

  async getServers(authToken: string): Promise<PlexServer[]> {
    const response = await axios.get(`${PLEX_API_URL}/resources`, {
      headers: {
        ...this.headers,
        'X-Plex-Token': authToken,
      },
      params: {
        includeHttps: 1,
        includeRelay: 1,
      },
    });

    interface PlexResource {
      name: string;
      clientIdentifier: string;
      owned: boolean;
      accessToken?: string;
      provides: string;
    }

    return response.data
      .filter((r: PlexResource) => r.provides.includes('server'))
      .map((r: PlexResource) => ({
        name: r.name,
        machineIdentifier: r.clientIdentifier,
        owned: r.owned,
        accessToken: r.accessToken,
      }));
  }

  async validateServerAccess(
    authToken: string,
    serverMachineIdentifier: string
  ): Promise<boolean> {
    const servers = await this.getServers(authToken);
    return servers.some((s) => s.machineIdentifier === serverMachineIdentifier);
  }
}

export function createPlexAuthClient(clientId?: string): PlexAuthClient {
  return new PlexAuthClient(clientId || process.env.PLEX_CLIENT_ID);
}
