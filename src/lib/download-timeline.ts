import type { QueueItem } from '@/types';

interface DownloadTimelineStep {
  name: string;
  state: 'pending' | 'active' | 'complete' | 'unverified' | 'failed';
  current: boolean;
}

/** File inspection can finish while transfer continues. Neither implies that import is complete. */
export function getDownloadTimeline(item: QueueItem, phase: string, hasAudioRequest: boolean): DownloadTimelineStep[] {
  const names = hasAudioRequest ? ['Search', 'Download', 'File checking', 'Import', 'Audio', 'Ready'] :
    ['Search', 'Download', 'File checking', 'Import', 'Ready'];
  const searching = phase === 'searching' || phase.startsWith('waiting_for_');
  const submitting = phase === 'submitting' || phase === 'metadata';
  const ready = phase === 'ready';
  const fileChecking = phase === 'file_checking';
  const importing = phase === 'importing' || phase === 'downloaded';
  const audioProcessing = hasAudioRequest && ['checking_audio', 'validating', 'merging', 'replacing', 'verifying'].includes(phase);
  const failed = phase === 'error';
  const current = ready ? names.length - 1 : searching ? 0 : fileChecking ? 2 :
    importing ? 3 : audioProcessing ? 4 : phase === 'validating' ? 2 : 1;
  const transferStarted = !searching && !submitting && (item.progress > 0 || !!item.startDate ||
    ['downloading', 'file_checking'].includes(phase) || importing || audioProcessing || ready);
  const transferComplete = !searching && !submitting && (item.progress >= 100 || importing || audioProcessing || ready);
  const check = searching || submitting ? undefined : item.audioCheck?.state;
  return names.map((name, index): DownloadTimelineStep => {
    let state: DownloadTimelineStep['state'] = 'pending';
    if (index === 0) state = transferStarted || submitting || ready ? 'complete' : failed ? 'pending' : 'active';
    else if (index === 1) state = transferComplete ? 'complete' : !failed && !searching ? 'active' : 'pending';
    else if (index === 2) state = check === 'description_only' || check === 'unsafe_files' ? 'failed' :
      check === 'no_description_marked' || check === 'description_included' ? 'complete' :
        fileChecking ? 'active' : check === 'unverified' || importing || audioProcessing || ready ? 'unverified' : 'pending';
    else if (index === names.length - 1) state = ready ? 'complete' : 'pending';
    else state = ready || !failed && current > index ? 'complete' : !failed && current === index ? 'active' : 'pending';
    return { name, state, current: !failed && current === index };
  });
}
