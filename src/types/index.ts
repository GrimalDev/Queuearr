export interface RadarrMovie {
  id?: number;
  title: string;
  originalTitle?: string;
  sortTitle?: string;
  sizeOnDisk?: number;
  overview?: string;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images?: MediaImage[];
  website?: string;
  year: number;
  hasFile?: boolean;
  youTubeTrailerId?: string;
  studio?: string;
  path?: string;
  qualityProfileId?: number;
  monitored?: boolean;
  minimumAvailability?: 'announced' | 'inCinemas' | 'released' | 'preDB';
  isAvailable?: boolean;
  folderName?: string;
  runtime?: number;
  cleanTitle?: string;
  imdbId?: string;
  tmdbId: number;
  titleSlug?: string;
  rootFolderPath?: string;
  certification?: string;
  genres?: string[];
  tags?: number[];
  added?: string;
  ratings?: {
    imdb?: { votes: number; value: number };
    tmdb?: { votes: number; value: number };
    metacritic?: { votes: number; value: number };
    rottenTomatoes?: { votes: number; value: number };
  };
  popularity?: number;
  status?: string;
}

export interface RadarrQueueItem {
  id: number;
  movieId?: number;
  movie?: RadarrMovie;
  title: string;
  status: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  statusMessages?: { title: string; messages: string[] }[];
  errorMessage?: string;
  downloadId?: string;
  protocol: string;
  downloadClient?: string;
  indexer?: string;
  outputPath?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  downloadClientHasPostImportCategory?: boolean;
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: number;
  items?: QualityProfileItem[];
}

export interface QualityProfileItem {
  id?: number;
  name?: string;
  quality?: { id: number; name: string; source: string; resolution: number };
  items?: QualityProfileItem[];
  allowed?: boolean;
}

export interface RadarrRootFolder {
  id: number;
  path: string;
  accessible?: boolean;
  freeSpace?: number;
  unmappedFolders?: { name: string; path: string }[];
}

export interface SonarrSeries {
  id?: number;
  title: string;
  alternateTitles?: { title: string; seasonNumber?: number }[];
  sortTitle?: string;
  status?: string;
  ended?: boolean;
  overview?: string;
  previousAiring?: string;
  nextAiring?: string;
  network?: string;
  airTime?: string;
  images?: MediaImage[];
  seasons?: SonarrSeason[];
  year: number;
  path?: string;
  qualityProfileId?: number;
  languageProfileId?: number;
  seasonFolder?: boolean;
  monitored?: boolean;
  useSceneNumbering?: boolean;
  runtime?: number;
  tvdbId: number;
  tvRageId?: number;
  tvMazeId?: number;
  firstAired?: string;
  seriesType?: 'standard' | 'daily' | 'anime';
  cleanTitle?: string;
  imdbId?: string;
  titleSlug?: string;
  rootFolderPath?: string;
  certification?: string;
  genres?: string[];
  tags?: number[];
  added?: string;
  ratings?: {
    votes: number;
    value: number;
  };
  statistics?: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored?: boolean;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

export interface SonarrQueueItem {
  id: number;
  seriesId?: number;
  series?: SonarrSeries;
  episodeId?: number;
  episode?: SonarrEpisode;
  title: string;
  status: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  statusMessages?: { title: string; messages: string[] }[];
  errorMessage?: string;
  downloadId?: string;
  protocol: string;
  downloadClient?: string;
  indexer?: string;
  outputPath?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  tvdbId?: number;
  episodeFileId?: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  airDateUtc?: string;
  overview?: string;
  hasFile?: boolean;
  monitored?: boolean;
  absoluteEpisodeNumber?: number;
  sceneAbsoluteEpisodeNumber?: number;
  sceneEpisodeNumber?: number;
  sceneSeasonNumber?: number;
  unverifiedSceneNumbering?: boolean;
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: number;
  items?: QualityProfileItem[];
}

export interface SonarrLanguageProfile {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff?: { id: number; name: string };
  languages?: { language: { id: number; name: string }; allowed: boolean }[];
}

export interface SonarrRootFolder {
  id: number;
  path: string;
  accessible?: boolean;
  freeSpace?: number;
  unmappedFolders?: { name: string; path: string }[];
}

export interface TransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  status: TransmissionStatus;
  percentDone: number;
  percentComplete?: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  etaIdle?: number;
  sizeWhenDone: number;
  leftUntilDone: number;
  totalSize: number;
  downloadedEver: number;
  uploadedEver: number;
  uploadRatio: number;
  isStalled: boolean;
  isFinished: boolean;
  error: TransmissionErrorType;
  errorString: string;
  peersConnected: number;
  peersSendingToUs: number;
  peersGettingFromUs: number;
  addedDate: number;
  doneDate: number;
  activityDate: number;
  queuePosition: number;
  trackerStats?: TransmissionTrackerStats[];
  downloadDir?: string;
}

export enum TransmissionStatus {
  STOPPED = 0,
  CHECK_WAIT = 1,
  CHECK = 2,
  DOWNLOAD_WAIT = 3,
  DOWNLOAD = 4,
  SEED_WAIT = 5,
  SEED = 6,
}

export enum TransmissionErrorType {
  OK = 0,
  TRACKER_WARNING = 1,
  TRACKER_ERROR = 2,
  LOCAL_ERROR = 3,
}

export interface TransmissionTrackerStats {
  announce: string;
  announceState: number;
  downloadCount: number;
  hasAnnounced: boolean;
  hasScraped: boolean;
  host: string;
  id: number;
  isBackup: boolean;
  lastAnnouncePeerCount: number;
  lastAnnounceResult: string;
  lastAnnounceStartTime: number;
  lastAnnounceSucceeded: boolean;
  lastAnnounceTime: number;
  lastAnnounceTimedOut: boolean;
  lastScrapeResult: string;
  lastScrapeStartTime: number;
  lastScrapeSucceeded: boolean;
  lastScrapeTime: number;
  lastScrapeTimedOut: boolean;
  leecherCount: number;
  nextAnnounceTime: number;
  nextScrapeTime: number;
  scrape: string;
  scrapeState: number;
  seederCount: number;
  tier: number;
}

export interface TransmissionSessionStats {
  activeTorrentCount: number;
  pausedTorrentCount: number;
  torrentCount: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloadQueueSize: number;
  downloadQueueEnabled: boolean;
  seedQueueSize: number;
  seedQueueEnabled: boolean;
  currentStats: {
    uploadedBytes: number;
    downloadedBytes: number;
    filesAdded: number;
    secondsActive: number;
    sessionCount: number;
  };
  cumulativeStats: {
    uploadedBytes: number;
    downloadedBytes: number;
    filesAdded: number;
    secondsActive: number;
    sessionCount: number;
  };
}

export interface MediaImage {
  coverType: 'poster' | 'banner' | 'fanart' | 'screenshot' | 'headshot';
  url?: string;
  remoteUrl?: string;
}

export interface SearchResult {
  id: string;
  type: 'movie' | 'series';
  title: string;
  year: number;
  overview?: string;
  posterUrl?: string;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  status?: string;
  inLibrary: boolean;
  libraryId?: number;
  popularity?: number;
  popularitySource?: string;
  isDownloading?: boolean;
  monitoredId?: number;
  isWatching?: boolean;
}

export interface QueueItem {
  id: string;
  sourceId?: number;
  mediaId?: number;
  source: 'radarr' | 'sonarr' | 'transmission';
  title: string;
  subtitle?: string;
  status: QueueItemStatus;
  progress: number;
  size: number;
  sizeRemaining: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  eta?: string;
  isStalled: boolean;
  hasError: boolean;
  errorMessage?: string;
  downloadClient?: string;
  indexer?: string;
  addedAt?: string;
  peersConnected?: number;
  peersSendingToUs?: number;
  addedDate?: number;
  doneDate?: number;
  activityDate?: number;
}

export type QueueItemStatus = 
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'queued'
  | 'completed'
  | 'failed'
  | 'warning'
  | 'importing'
  | 'pending';

export interface Alert {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  source: 'radarr' | 'sonarr' | 'transmission' | 'system';
  relatedItemId?: string;
  timestamp: Date;
  dismissed: boolean;
}

export interface PlexUser {
  id: string;
  uuid: string;
  username: string;
  email: string;
  thumb?: string;
  authToken: string;
  title?: string;
}

export interface PlexPin {
  id: number;
  code: string;
  product: string;
  trusted: boolean;
  clientIdentifier: string;
  location: { code: string; country: string; city: string; time_zone: string; postal_code: string };
  expiresIn: number;
  createdAt: string;
  expiresAt: string;
  authToken?: string;
}

export interface PlexServer {
  name: string;
  machineIdentifier: string;
  owned: boolean;
  accessToken?: string;
}

export interface ServiceSettings {
  radarr: {
    url: string;
    apiKey: string;
    defaultQualityProfileId?: number;
    defaultRootFolderPath?: string;
  };
  sonarr: {
    url: string;
    apiKey: string;
    defaultQualityProfileId?: number;
    defaultLanguageProfileId?: number;
    defaultRootFolderPath?: string;
  };
  transmission: {
    url: string;
    username?: string;
    password?: string;
  };
  plex: {
    clientId: string;
    serverMachineIdentifier?: string;
  };
}
