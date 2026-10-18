import axios from 'axios';
import { NextResponse } from 'next/server';
import { isAbsolute } from 'node:path';

export class AudioConfigurationError extends Error {}

export function logMovieAudioError(context: string, cause?: unknown, detail?: string): void {
  if (detail) {
    console.warn(`[audio] ${context}: ${detail}`);
    return;
  }
  // HTTP errors can embed credentials, request headers and signed download URLs.
  const code = cause && typeof cause === 'object' && 'code' in cause &&
    typeof cause.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(cause.code) ? cause.code : undefined;
  const httpError = axios.isAxiosError(cause);
  const status = httpError ? cause.response?.status : undefined;
  // Node filesystem diagnostics identify the failed mount without dumping HTTP errors.
  const filesystem = !httpError && cause && typeof cause === 'object' &&
    ['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR', 'ENOSPC', 'EDQUOT', 'EIO'].includes(code ?? '')
    ? cause as { syscall?: unknown; path?: unknown; dest?: unknown } : undefined;
  const localPath = (value: unknown): string | undefined =>
    typeof value === 'string' && isAbsolute(value) && !value.includes('://') ? value : undefined;
  const syscall = typeof filesystem?.syscall === 'string' && /^[a-zA-Z_-]{1,40}$/.test(filesystem.syscall)
    ? filesystem.syscall : undefined;
  console.warn(`[audio] ${context}: operation failed`, {
    code, status,
    ...(filesystem ? { syscall, path: localPath(filesystem.path), dest: localPath(filesystem.dest) } : {}),
  });
}

export function movieAudioErrorResponse(context: string, status: number, detail?: string, cause?: unknown): NextResponse {
  logMovieAudioError(context, cause, detail);
  return NextResponse.json({ error: 'Error' }, { status });
}
