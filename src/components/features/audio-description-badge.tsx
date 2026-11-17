import { Badge } from '@/components/ui/badge';
import type { DownloadAudioCheck } from '@/types';

export function AudioDescriptionBadge({ suspected, check }: { suspected?: boolean; check?: DownloadAudioCheck }): React.JSX.Element {
  const label = check?.state === 'description_only' ? 'Requested audio: description only' :
    check?.state === 'description_included' ? 'Includes audio description' : suspected ? 'Audio description advertised' : check?.state === 'checking' ? 'Checking audio type' :
      check?.state === 'no_description_marked' ? 'No AD marker found' : 'Audio type unverified';
  return <Badge variant="outline" className={suspected || check?.state === 'description_only' ? 'border-amber-500/50 text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
    title={check?.detail ?? 'Release labels and file metadata can identify audio description. Missing or incorrect labels cannot prove normal audio.'}>{label}</Badge>;
}
