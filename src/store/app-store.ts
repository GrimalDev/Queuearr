import { create } from 'zustand';
import { SearchResult, QueueItem, Alert } from '@/types';

export interface QueueServiceError {
  service: 'radarr' | 'sonarr' | 'transmission';
  message: string;
}

interface AppState {
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  searchType: 'all' | 'movies' | 'series';

  queueItems: QueueItem[];
  isLoadingQueue: boolean;
  queueErrors: QueueServiceError[];

  alerts: Alert[];

  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  setSearchType: (type: 'all' | 'movies' | 'series') => void;

  setQueueItems: (items: QueueItem[]) => void;
  setIsLoadingQueue: (isLoading: boolean) => void;
  setQueueErrors: (errors: QueueServiceError[]) => void;

  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  searchType: 'all',

  queueItems: [],
  isLoadingQueue: false,
  queueErrors: [],

  alerts: [],

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setSearchType: (type) => set({ searchType: type }),

  setQueueItems: (items) => set({ queueItems: items }),
  setIsLoadingQueue: (isLoading) => set({ isLoadingQueue: isLoading }),
  setQueueErrors: (errors) => set({ queueErrors: errors }),

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
