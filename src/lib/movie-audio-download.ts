import axios from 'axios';
import { AudioConfigurationError } from '@/lib/movie-audio-errors';
import { createHttpsAgentForService } from '@/lib/api/tls';
import type { MovieAudioTorrentSource, Release } from '@/types';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

function sourceUrl(value: string, base?: URL): URL {
  try {
    return new URL(value, base);
  } catch {
    // URLs may contain indexer API keys or tracker passkeys. Never include them in errors.
    throw new AudioConfigurationError('The indexer returned an invalid torrent metadata link.');
  }
}

export async function getMovieAudioTorrentSource(
  release: Pick<Release, 'magnetUrl' | 'downloadUrl'>, signal?: AbortSignal,
): Promise<MovieAudioTorrentSource> {
  signal?.throwIfAborted();
  const initialUrl = release.magnetUrl || release.downloadUrl;
  if (!initialUrl) throw new AudioConfigurationError('The audio donor has no torrent metadata link.');
  let current = sourceUrl(initialUrl);
  const deadline = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let redirects = 0; ; redirects++) {
    requestSignal.throwIfAborted();
    if (current.protocol === 'magnet:') {
      if (!current.searchParams.getAll('xt').some((value) => /^urn:(btih|btmh):[a-z0-9]+$/i.test(value))) {
        throw new AudioConfigurationError('The indexer returned a magnet link without a supported torrent hash.');
      }
      return { filename: current.href };
    }
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new AudioConfigurationError('The indexer returned an unsupported torrent metadata protocol.');
    }
    // Handle redirects ourselves: an HTTP client cannot fetch a magnet URI.
    // Each hop is a fresh request; Radarr headers and prior-hop cookies are never forwarded.
    const response = await axios.get<ArrayBuffer>(current.href, {
      responseType: 'arraybuffer', timeout: 20_000, signal: requestSignal,
      maxContentLength: 2 * 1024 * 1024, maxRedirects: 0,
      httpsAgent: createHttpsAgentForService('indexer'),
      headers: { Accept: 'application/x-bittorrent', 'X-Api-Key': undefined, Authorization: undefined, Cookie: undefined },
      validateStatus: (status) => (status >= 200 && status < 300) || REDIRECT_STATUSES.has(status),
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      const data = Buffer.from(response.data);
      if (data[0] !== 100) throw new AudioConfigurationError('The indexer did not return torrent metadata.');
      return { metainfo: data.toString('base64') };
    }
    if (redirects >= MAX_REDIRECTS) throw new AudioConfigurationError('The indexer exceeded the torrent metadata redirect limit.');
    const location = response.headers.location;
    if (typeof location !== 'string' || !location.trim()) {
      throw new AudioConfigurationError('The indexer redirected torrent metadata without a destination.');
    }
    const next = sourceUrl(location, current);
    if (current.protocol === 'https:' && next.protocol === 'http:') {
      throw new AudioConfigurationError('The indexer attempted to redirect torrent metadata from HTTPS to unencrypted HTTP.');
    }
    current = next;
  }
}
