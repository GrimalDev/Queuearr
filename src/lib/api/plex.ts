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

  getAuthUrl(pin: PlexPin, forwardUrl: string): string {
    const params = new URLSearchParams({
      clientID: this.clientId,
      code: pin.code,
      'context[device][product]': 'Queuearr',
      'context[device][version]': '1.0.0',
      'context[device][platform]': 'Web',
      'context[device][platformVersion]': '1.0.0',
      'context[device][device]': 'Browser',
      'context[device][deviceName]': 'Queuearr Web App',
      forwardUrl,
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

// ============================================================
// Plex Admin Client (server-side only - uses PLEX_ADMIN_TOKEN)
// ============================================================

const PLEX_TV_API = 'https://plex.tv/api';

export interface PlexLibrarySection {
  id: number;
  key: string;
  title: string;
  type: string; // 'movie' | 'show' | 'artist' | 'photo'
}

export interface PlexShareResult {
  success: boolean;
  message?: string;
  alreadyShared?: boolean;
  alreadyInvited?: boolean;
}

export class PlexAdminClient {
  private adminToken: string;
  private machineIdentifier: string;
  private clientId: string;

  constructor() {
    const adminToken = process.env.PLEX_ADMIN_TOKEN;
    const machineIdentifier = process.env.PLEX_SERVER_MACHINE_IDENTIFIER;
    const clientId = process.env.PLEX_CLIENT_ID;

    if (!adminToken) {
      throw new Error('PLEX_ADMIN_TOKEN is not configured');
    }
    if (!machineIdentifier) {
      throw new Error('PLEX_SERVER_MACHINE_IDENTIFIER is not configured');
    }
    if (!clientId) {
      throw new Error('PLEX_CLIENT_ID is not configured');
    }

    this.adminToken = adminToken;
    this.machineIdentifier = machineIdentifier;
    this.clientId = clientId;
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Plex-Token': this.adminToken,
      'X-Plex-Client-Identifier': this.clientId,
      'X-Plex-Product': 'Queuearr',
      'X-Plex-Version': '1.0.0',
      'X-Plex-Platform': 'Web',
      'X-Plex-Device': 'Server',
      'X-Plex-Device-Name': 'Queuearr Server',
    };
  }

  /**
   * Fetch library sections from the Plex server
   */
  async getLibrarySections(): Promise<PlexLibrarySection[]> {
    const url = `${PLEX_TV_API}/servers/${this.machineIdentifier}`;
    const response = await axios.get(url, {
      headers: this.headers,
      params: { 'X-Plex-Token': this.adminToken },
    });

    const data = response.data;
    
    // If JSON response (when Accept: application/json works)
    if (typeof data === 'object' && data.MediaContainer) {
      const server = data.MediaContainer.Server?.[0];
      if (!server?.Section) return [];
      return server.Section.map((s: { id: number; key: string; title: string; type: string }) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        type: s.type,
      }));
    }

    // Parse XML response (plex.tv API returns XML by default)
    if (typeof data === 'string' && data.includes('<MediaContainer')) {
      const sections: PlexLibrarySection[] = [];
      // Match all Section elements: <Section id="123" key="1" type="movie" title="Movies"/>
      const sectionRegex = /<Section\s+id="(\d+)"\s+key="(\d+)"\s+type="(\w+)"\s+title="([^"]+)"\s*\/>/g;
      let match;
      while ((match = sectionRegex.exec(data)) !== null) {
        sections.push({
          id: parseInt(match[1], 10),
          key: match[2],
          title: match[4],
          type: match[3],
        });
      }
      return sections;
    }

    return [];
  }

  /**
   * Share library with a user by email
   * This sends an invite if user doesn't have Plex account
   */
  async shareLibrary(
    email: string,
    librarySectionIds: number[] = [], // empty = all libraries
    options: {
      allowSync?: boolean;
      allowCameraUpload?: boolean;
      allowChannels?: boolean;
    } = {}
  ): Promise<PlexShareResult> {
    const url = `${PLEX_TV_API}/servers/${this.machineIdentifier}/shared_servers`;

    const payload = {
      server_id: this.machineIdentifier,
      shared_server: {
        library_section_ids: librarySectionIds,
        invited_email: email,
      },
      sharing_settings: {
        allowSync: options.allowSync ? '1' : '0',
        allowCameraUpload: options.allowCameraUpload ? '1' : '0',
        allowChannels: options.allowChannels ? '1' : '0',
      },
    };

    try {
      await axios.post(url, payload, { headers: this.headers });
      return { success: true };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const rawMessage =
          typeof data === 'string'
            ? data
            : data
              ? JSON.stringify(data)
              : '';
        const normalizedMessage = rawMessage.toLowerCase();
        const alreadySharedMessageHints = [
          'already shared',
          'already has access',
          'has already been shared',
          'sharing this server',
          'please edit your existing share',
        ];
        const alreadyInvitedMessageHints = [
          'already invited',
          'has already been invited',
          'invitation already sent',
          'pending invitation',
        ];
        const hasAlreadySharedHint = alreadySharedMessageHints.some((hint) =>
          normalizedMessage.includes(hint)
        );
        const hasAlreadyInvitedHint = alreadyInvitedMessageHints.some((hint) =>
          normalizedMessage.includes(hint)
        );

        if (status === 422 || ((status === 400 || status === 409) && hasAlreadySharedHint)) {
          // Already shared with this user
          return { success: true, alreadyShared: true, message: 'Already shared with this user' };
        }
        if ((status === 400 || status === 409) && hasAlreadyInvitedHint) {
          return {
            success: true,
            alreadyInvited: true,
            message: rawMessage || 'Plex invitation already pending for this user',
          };
        }
        if (status === 401) {
          return { success: false, message: 'Invalid admin token' };
        }
        return { 
          success: false, 
          message: typeof data === 'string' ? data : 'Failed to share library' 
        };
      }
      throw error;
    }
  }

  /**
   * Get list of current shared users
   */
  async getSharedUsers(): Promise<Array<{ id: number; email: string; username: string }>> {
    const url = `${PLEX_TV_API}/servers/${this.machineIdentifier}/shared_servers`;

    try {
      const response = await axios.get(url, { headers: this.headers });
      const data = response.data;
      
      if (data.MediaContainer?.SharedServer) {
        return data.MediaContainer.SharedServer
          .map((s: { id: number; email?: string; username?: string }) => ({
            id: Number.parseInt(String(s.id), 10),
            email: typeof s.email === 'string' ? s.email : '',
            username: typeof s.username === 'string' ? s.username : '',
          }))
          .filter((s: { id: number; email: string; username: string }) => Number.isInteger(s.id) && s.id > 0);
      }

      // Fallback for XML responses from plex.tv API
      if (typeof data === 'string' && data.includes('<MediaContainer')) {
        const sharedUsers: Array<{ id: number; email: string; username: string }> = [];
        const sharedServerRegex = /<SharedServer\b([^>]*)\/?>/g;
        const attrRegex = /(\w+)="([^"]*)"/g;
        let sharedMatch: RegExpExecArray | null;

        while ((sharedMatch = sharedServerRegex.exec(data)) !== null) {
          const attrs = sharedMatch[1];
          let id = 0;
          let email = '';
          let username = '';
          let attrMatch: RegExpExecArray | null;

          while ((attrMatch = attrRegex.exec(attrs)) !== null) {
            const key = attrMatch[1];
            const value = attrMatch[2];
            if (key === 'id') id = Number.parseInt(value, 10);
            if (key === 'email') email = value;
            if (key === 'username') username = value;
          }

          if (Number.isInteger(id) && id > 0 && email) {
            sharedUsers.push({ id, email, username });
          }
        }

        return sharedUsers;
      }

      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message =
          typeof data === 'string'
            ? data
            : data
              ? JSON.stringify(data)
              : error.message;
        throw new Error(
          `Failed to fetch Plex shared users${status ? ` (${status})` : ''}: ${message}`
        );
      }
      throw error;
    }
  }

  /**
   * Remove library share from a user
   */
  async removeShare(sharedServerId: number): Promise<boolean> {
    const url = `${PLEX_TV_API}/servers/${this.machineIdentifier}/shared_servers/${sharedServerId}`;

    try {
      await axios.delete(url, { headers: this.headers });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of pending (not-yet-accepted) invitations sent by the admin.
   * These live at a different endpoint than accepted shares.
   */
  async getPendingInvites(): Promise<Array<{ id: number; email: string; username: string }>> {
    const url = `${PLEX_TV_API}/invites/requested`;

    try {
      const response = await axios.get(url, { headers: this.headers });
      const data = response.data;

      // JSON response
      if (typeof data === 'object' && data !== null && data.MediaContainer?.Invite) {
        return (data.MediaContainer.Invite as Array<{ id: number; email?: string; username?: string }>)
          .map((invite) => ({
            id: Number(invite.id),
            email: typeof invite.email === 'string' ? invite.email : '',
            username: typeof invite.username === 'string' ? invite.username : '',
          }))
          .filter((invite) => Number.isInteger(invite.id) && invite.id > 0);
      }

      // XML response fallback
      if (typeof data === 'string' && data.includes('<MediaContainer')) {
        const pendingInvites: Array<{ id: number; email: string; username: string }> = [];
        const inviteRegex = /<Invite\b([^>]*)\/?>/g;
        const attrRegex = /(\w+)="([^"]*)"/g;
        let inviteMatch: RegExpExecArray | null;

        while ((inviteMatch = inviteRegex.exec(data)) !== null) {
          const attrs = inviteMatch[1];
          let id = 0;
          let email = '';
          let username = '';
          let attrMatch: RegExpExecArray | null;
          attrRegex.lastIndex = 0;

          while ((attrMatch = attrRegex.exec(attrs)) !== null) {
            const key = attrMatch[1];
            const value = attrMatch[2];
            if (key === 'id') id = Number.parseInt(value, 10);
            if (key === 'email') email = value;
            if (key === 'username') username = value;
          }

          if (Number.isInteger(id) && id > 0) {
            pendingInvites.push({ id, email, username });
          }
        }

        return pendingInvites;
      }

      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message =
          typeof data === 'string'
            ? data
            : data
              ? JSON.stringify(data)
              : error.message;
        throw new Error(
          `Failed to fetch pending Plex invites${status ? ` (${status})` : ''}: ${message}`
        );
      }
      throw error;
    }
  }

  /**
   * Cancel a pending (not-yet-accepted) Plex invitation by its invite ID.
   */
  async cancelPendingInvite(inviteId: number): Promise<boolean> {
    const url = `${PLEX_TV_API}/invites/requested/${inviteId}`;

    try {
      await axios.delete(url, {
        headers: this.headers,
        params: { friend: 1, home: 0, server: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }
}

let plexAdminClientInstance: PlexAdminClient | null = null;

export function getPlexAdminClient(): PlexAdminClient {
  if (!plexAdminClientInstance) {
    plexAdminClientInstance = new PlexAdminClient();
  }
  return plexAdminClientInstance;
}
