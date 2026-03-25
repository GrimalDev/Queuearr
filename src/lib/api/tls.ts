import fs from 'node:fs';
import https from 'node:https';

type ServiceName = 'radarr' | 'sonarr' | 'transmission';

const cache = new Map<string, string>();

function readCaFromPath(path: string): string {
  const cached = cache.get(path);
  if (cached) return cached;
  const value = fs.readFileSync(path, 'utf8');
  cache.set(path, value);
  return value;
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
