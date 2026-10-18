import { create } from 'zustand';
import { SearchResult, QueueItem, Alert, PendingQueueRequest } from '@/types';

export interface QueueServiceError {
  service: 'radarr' | 'sonarr' | 'transmission' | 'audio';
  message: string;
}

export type SearchSortKey = 'rating' | 'popularity' | 'year' | 'recent';
export type SearchSortDir = 'asc' | 'desc';

interface AppState {
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchType: 'all' | 'movies' | 'series';
  searchSortKey: SearchSortKey;
  searchSortDir: SearchSortDir;

  queueItems: QueueItem[];
  isLoadingQueue: boolean;
  queueErrors: QueueServiceError[];
  pendingQueueRequests: PendingQueueRequest[];

  alerts: Alert[];

  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  setSearchType: (type: 'all' | 'movies' | 'series') => void;
  setSearchSort: (key: SearchSortKey, dir: SearchSortDir) => void;

  setQueueItems: (items: QueueItem[]) => void;
  setIsLoadingQueue: (isLoading: boolean) => void;
  setQueueErrors: (errors: QueueServiceError[]) => void;
  startQueueRequest: (request: PendingQueueRequest) => void;
  finishQueueRequest: (id: string) => void;

  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  searchType: 'all',
  searchSortKey: 'popularity',
  searchSortDir: 'desc',

  queueItems: [],
  isLoadingQueue: false,
  queueErrors: [],
  pendingQueueRequests: [],

  alerts: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setSearchType: (type) => set({ searchType: type }),
  setSearchSort: (key, dir) => set({ searchSortKey: key, searchSortDir: dir }),

  setQueueItems: (items) => set({ queueItems: items }),
  setIsLoadingQueue: (isLoading) => set({ isLoadingQueue: isLoading }),
  setQueueErrors: (errors) => set({ queueErrors: errors }),
  startQueueRequest: (request) => set((state) => ({
    pendingQueueRequests: [...state.pendingQueueRequests.filter((entry) => entry.item.id !== request.item.id), request],
  })),
  finishQueueRequest: (id) => set((state) => ({
    pendingQueueRequests: state.pendingQueueRequests.filter((entry) => entry.item.id !== id),
  })),

  addAlert: (alert) =>
    set((state) => ({
      alerts: [
        ...state.alerts,
        {
          ...alert,
          id: crypto.randomUUID(),
          timestamp: new Date(),
          dismissed: false,
        },
      ],
    })),
  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    })),
  clearAlerts: () => set({ alerts: [] }),
}));
