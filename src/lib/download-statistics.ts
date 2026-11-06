export function formatDateCell(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultDownloadStatsDates(now = new Date()): { from: string; to: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  return { from: formatDateCell(start), to: formatDateCell(now) };
}

export function downloadStatsDateBounds(from: string, to: string): { start: string; end: string } | null {
  const parse = (value: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1970) return null;
    const date = new Date(year, month - 1, day);
    return formatDateCell(date) === value ? date : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (!start || !end || start > end) return null;
  // Calendar arithmetic preserves local midnight across daylight-saving changes.
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function downloadPiePath(start: number, end: number): string {
  const point = (fraction: number): string => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    return `${120 + 108 * Math.cos(angle)} ${120 + 108 * Math.sin(angle)}`;
  };
  if (end - start >= 1) return 'M 120 12 A 108 108 0 1 1 120 228 A 108 108 0 1 1 120 12 Z';
  return `M 120 120 L ${point(start)} A 108 108 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)} Z`;
}
