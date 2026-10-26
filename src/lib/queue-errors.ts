interface QueueDiagnostics {
  errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
}

/** Keep error detection working without returning service diagnostics to regular users. */
export function restrictQueueDiagnostics<T extends QueueDiagnostics>(item: T, isAdmin: boolean): T {
  if (isAdmin) return item;
  return { ...item,
    errorMessage: item.errorMessage ? 'Error' : undefined,
    statusMessages: item.statusMessages?.map(() => ({ title: 'Error', messages: ['Error'] })),
  };
}

export function getQueueErrorMessage(item: QueueDiagnostics, transmissionError?: string): string | undefined {
  const messages = [item.errorMessage, ...(item.statusMessages ?? []).map((status) =>
    [status.title, ...status.messages].filter(Boolean).join('\n')), transmissionError];
  return [...new Set(messages.filter((message): message is string => !!message?.trim()))].join('\n\n') || undefined;
}
