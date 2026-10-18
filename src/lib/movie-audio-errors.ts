import axios from 'axios';
import { NextResponse } from 'next/server';

export class AudioConfigurationError extends Error {}

export function logMovieAudioError(context: string, cause?: unknown, detail?: string): void {
  if (detail) {
    console.warn(`[audio] ${context}: ${detail}`);
    return;
  }
  // HTTP errors can embed credentials, request headers and signed download URLs.
  const code = cause && typeof cause === 'object' && 'code' in cause &&
    typeof cause.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(cause.code) ? cause.code : undefined;
  const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;
  console.warn(`[audio] ${context}: operation failed`, { code, status });
}

export function movieAudioErrorResponse(context: string, status: number, detail?: string, cause?: unknown): NextResponse {
  logMovieAudioError(context, cause, detail);
  return NextResponse.json({ error: 'Error' }, { status });
}
