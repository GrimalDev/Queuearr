import { AudioLines, Loader2, Search } from 'lucide-react';

export function AudioSearchIndicator({ label = 'Searching for audio…', audio = true }: { label?: string; audio?: boolean }): React.JSX.Element {
  const Icon = audio ? AudioLines : Search;
  return (
    <div role="status" className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="size-4 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
        <span className="flex-1">{label}</span>
        <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <div className="audio-search-sweep absolute h-full w-1/3 rounded-full bg-foreground/60" />
      </div>
    </div>
  );
}
