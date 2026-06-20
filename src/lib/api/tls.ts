import fs from 'node:fs';
import https from 'node:https';

type ServiceName = 'radarr' | 'sonarr' | 'transmission';

const cache = new Map<string, string>();

function readCaFromPath(path: string): string | undefined {
  const cached = cache.get(path);
  if (cached) return cached;
  try {
    const value = fs.readFileSync(path, 'utf8');
    cache.set(path, value);
    return value;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.warn(`[tls] CA cert file not found at "${path}" — proceeding without custom CA.`);
    } else {
      console.warn(`[tls] Could not read CA cert file at "${path}": ${String(err)}`);
    }
    return undefined;
  }
}

function resolveCaPem(service: ServiceName): string | undefined {
  const prefix = service.toUpperCase();
  const path =
    process.env[`${prefix}_CA_CERT_PATH`] ??
    process.env.SERVICE_CA_CERT_PATH;
  if (path?.trim()) {
    return readCaFromPath(path.trim());
  }

  return undefined;
}

export function createHttpsAgentForService(service: ServiceName): https.Agent | undefined {
  const ca = resolveCaPem(service);
  if (!ca) return undefined;
  return new https.Agent({
    ca,
    rejectUnauthorized: true,
  });
}
