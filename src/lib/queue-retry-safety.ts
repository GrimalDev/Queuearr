/** Failed/blocked imports can retry; an importer currently writing files cannot. */
export function isImportInProgress(item: { status: string; trackedDownloadState?: string }): boolean {
  const state = item.trackedDownloadState?.toLowerCase() ?? '';
  return state === 'importing' || item.status.toLowerCase() === 'importing' && !/blocked|failed|pending/.test(state);
}
