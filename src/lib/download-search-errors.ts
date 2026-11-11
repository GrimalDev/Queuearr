import axios from 'axios';
import type { Release } from '@/types';
import { summarizeReleaseSearch } from '@/lib/release-search-retry';

/** Persist only controlled text and diagnostic codes, never HTTP bodies or signed URLs. */
export function describeDownloadSearchError(service: string, operation: string, cause: unknown): string {
  const diagnostics: string[] = [];
  if (axios.isAxiosError(cause) && Number.isInteger(cause.response?.status)) {
    diagnostics.push(`HTTP ${cause.response!.status}`);
  }
  let nested: unknown = cause;
  for (let depth = 0; depth < 5 && nested && typeof nested === 'object'; depth++) {
    if ('code' in nested && typeof nested.code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(nested.code)) {
      diagnostics.push(nested.code);
    }
    nested = 'cause' in nested ? nested.cause : undefined;
  }
  const codes = [...new Set(diagnostics)];
  return `${service}: ${operation} failed.${codes.length ? ` ${codes.join(', ')}.` : ' No further safe diagnostic was supplied by the service.'}`;
}

export function describeRejectedMovieReleases(releases: Release[]): string {
  const summary = summarizeReleaseSearch(releases);
  if (!summary.returned) return 'Radarr returned no releases for this movie. No release was available to select.';
  return `Radarr returned ${summary.returned} releases, but none passed release selection. ` +
    `Rejected: ${summary.rejected}; quality/profile: ${summary.quality}; language/audio: ${summary.language}; ` +
    `custom format/score: ${summary.customFormat}; blocklist: ${summary.blocklisted}. ` +
    'Rejection categories can overlap. Check Radarr Interactive Search for individual rejection reasons.';
}

/** Legacy failures have no recorded cause. Do not invent one from their status alone. */
export function getDownloadSearchErrorDetail(job: { state: string; detail?: string | null } | undefined): string | undefined {
  if (!job || !['search_failed', 'needs_review', 'needs_selection', 'in_cinemas'].includes(job.state)) return undefined;
  if (job.detail?.trim()) return job.detail;
  if (job.state === 'needs_selection') return 'This saved request needs an explicit movie, season or episode selection before searching.';
  if (job.state === 'needs_review') return 'This saved request requires review before another release can be submitted. No detailed reason was saved by the previous version.';
  if (job.state === 'in_cinemas') return 'The movie is still in cinemas and the last search did not select an eligible release. No detailed reason was saved by the previous version.';
  return 'The previous search failed or ended without a matching download. The previous version did not record its cause. Retry the search to capture diagnostics.';
}
