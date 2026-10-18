'use client';

import { DownloadQueueCard } from '@/components/features/download-queue-card';
import type { QueueItem } from '@/types';

export function AudioQueueCard({ item }: { item: QueueItem }): React.JSX.Element {
  return <DownloadQueueCard item={item} />;
}
