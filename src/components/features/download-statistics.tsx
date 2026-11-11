'use client';

import { useEffect, useId, useState } from 'react';
import { CalendarDays, ChartPie, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { defaultDownloadStatsDates, downloadPiePath, downloadStatsDateBounds } from '@/lib/download-statistics';
import type { DownloadStatistics } from '@/types';

export function DownloadStatisticsChart({ data }: { data: DownloadStatistics }): React.JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const users = data.users.filter((user) => user.downloads > 0);
  const slices = users.map((user, index) => {
    const start = users.slice(0, index).reduce((total, previous) => total + previous.downloads, 0) / data.totalDownloads;
    return { ...user, path: downloadPiePath(start, start + user.downloads / data.totalDownloads), color: index < 5 ? `var(--chart-${index + 1})` : `hsl(${index * 137.508 % 360} 65% 58%)` };
  });
  if (!slices.length) return <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
    <ChartPie className="size-10" aria-hidden="true" />
    <p>No downloads in this date range.</p>
  </div>;
  return <div className="grid items-center gap-6 md:grid-cols-[minmax(200px,280px)_1fr]">
    <svg viewBox="0 0 240 240" role="img" aria-labelledby={`${titleId} ${descriptionId}`} className="mx-auto w-full max-w-72">
      <title id={titleId}>Downloads by user</title>
      <desc id={descriptionId}>{data.totalDownloads} download requests. Exact counts per user appear in the table.</desc>
      {slices.map((slice) => <path key={slice.userId ?? 'unknown'} d={slice.path} fill={slice.color} stroke="var(--background)" strokeWidth="2">
        <title>{`${slice.username}: ${slice.downloads} downloads, ${(slice.downloads / data.totalDownloads * 100).toFixed(1)}%`}</title>
      </path>)}
    </svg>
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Download requests per user for the selected date range</caption>
        <thead><tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="pb-3 font-normal">User</th>
          <th scope="col" className="pb-3 text-right font-normal">Downloads</th>
          <th scope="col" className="pb-3 pl-4 text-right font-normal">Share</th>
        </tr></thead>
        <tbody>{slices.map((slice) => <tr key={slice.userId ?? 'unknown'} className="border-b last:border-0">
          <th scope="row" className="py-3 pr-3 text-left font-medium"><span className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
            <span className="break-words">{slice.username}</span>
          </span></th>
          <td className="py-3 text-right tabular-nums">{slice.downloads.toLocaleString()}</td>
          <td className="py-3 pl-4 text-right tabular-nums text-muted-foreground">{(slice.downloads / data.totalDownloads * 100).toFixed(1)}%</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function DownloadStatisticsPanel(): React.JSX.Element {
  const [dates, setDates] = useState(() => defaultDownloadStatsDates());
  const [data, setData] = useState<DownloadStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const prefix = useId();
  const bounds = downloadStatsDateBounds(dates.from, dates.to);
  const start = bounds?.start;
  const end = bounds?.end;
  const visibleUsers = data?.users.filter((user) => includeUnknown || user.userId !== null) ?? [];
  const visibleData = data ? { ...data, users: visibleUsers, totalDownloads: visibleUsers.reduce((total, user) => total + user.downloads, 0) } : null;
  useEffect(() => {
    if (!start || !end) return;
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      setLoading(true); setError(false);
      try {
        const params = new URLSearchParams({ start, end });
        const response = await fetch(`/api/admin/download-statistics?${params}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Error');
        const next: DownloadStatistics = await response.json();
        if (!controller.signal.aborted) setData(next);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [start, end, revision]);
  return <Card>
    <CardHeader>
      <CardTitle>Downloads by user</CardTitle>
      <CardDescription>Who initiated download requests in the selected period.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1 space-y-2 sm:flex-none">
          <Label htmlFor={`${prefix}-from`}>Start date</Label>
          <Input id={`${prefix}-from`} type="date" min="1970-01-01" max={dates.to || undefined} value={dates.from}
            onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-44" />
        </div>
        <div className="min-w-40 flex-1 space-y-2 sm:flex-none">
          <Label htmlFor={`${prefix}-to`}>End date</Label>
          <Input id={`${prefix}-to`} type="date" min={dates.from || '1970-01-01'} value={dates.to}
            onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-44" />
        </div>
        <Button variant="outline" onClick={() => { setDates(defaultDownloadStatsDates()); setRevision((value) => value + 1); }}>
          <CalendarDays className="size-4" aria-hidden="true" />Last 7 days
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={`${prefix}-include-unknown`} checked={includeUnknown} onCheckedChange={setIncludeUnknown} />
        <Label htmlFor={`${prefix}-include-unknown`}>Include unknown / external</Label>
      </div>
      {!bounds ? <p role="alert" className="text-sm text-destructive">Choose a valid start and end date.</p> : loading ?
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />Loading download statistics…
        </div> : error ? <div role="alert" className="flex items-center gap-3 py-8 text-sm text-destructive">
          Error<Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}><RotateCcw className="size-4" />Retry</Button>
        </div> : visibleData && <>
          <div><p className="text-3xl font-semibold tabular-nums">{visibleData.totalDownloads.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">download requests · {visibleUsers.filter((user) => user.userId !== null).length} known users</p></div>
          <DownloadStatisticsChart data={visibleData} />
        </>}
      <p className="text-xs leading-relaxed text-muted-foreground">Counts each movie, series, season, episode, or audio selection once. Retries and followers are excluded. History from before requester tracking began is partial and may appear as Unknown / external.</p>
    </CardContent>
  </Card>;
}
