export type SessionState =
  | 'unreviewed'
  | 'bookmarked'
  | 'resolved'
  | 'dismissed'
  | 'archival_context';
export type RetentionClass =
  | 'throwaway'
  | 'review_pending'
  | 'archival_context'
  | 'protected';
export type CompressionState =
  | 'raw_wav'
  | 'flac'
  | 'lossy'
  | 'pending_compression';
export type SyncState =
  | 'local_only'
  | 'pending_sync'
  | 'synced'
  | 'sync_failed';
export type BookmarkState =
  | 'unresolved'
  | 'resolved'
  | 'dismissed'
  | 'captured';

export interface Bookmark {
  id: string;
  timestamp_seconds: number;
  created_at?: string;
  state: BookmarkState;
  note: string;
}

export interface Clip {
  id: string;
  source_session_id: string;
  source_start_seconds: number;
  source_end_seconds: number;
  audio_path: string;
  audio_url: string;
  created_at: string;
  title: string;
  notes: string;
  sync_state: SyncState;
  storage_size_bytes: number;
}

export type TrashSourceState = 'active' | 'trashed' | 'unavailable';

export interface WaveformCache {
  session_id: string;
  generated_at: string;
  source: string;
  bucket_count: number;
  peaks: number[];
}

export interface Session {
  id: string;
  created_at: string;
  title: string;
  duration_seconds: number;
  audio_path: string;
  audio_url: string;
  state: SessionState;
  retention_class: RetentionClass;
  compression_state: CompressionState;
  sync_state: SyncState;
  notes: string;
  device_name?: string;
  sample_rate?: number;
  channel_count?: number;
  storage_size_bytes?: number;
  source_size_bytes: number;
  actual_source_size_bytes: number;
  bookmarks: Bookmark[];
  clips: string[];
  clip_details: Clip[];
  waveform: WaveformCache | null;
}

export interface StorageCandidate {
  id: string;
  age_days: number;
  size_bytes: number;
  safe_delete: boolean;
  compression_candidate: boolean;
  lossy_candidate: boolean;
  protected_reason: string;
  estimated_compression_savings_bytes: number;
}

export interface StorageSummary {
  total_bytes: number;
  free_bytes: number;
  minimum_free_bytes: number;
  estimated_recording_minutes: number;
  source_session_bytes: number;
  archival_context_bytes: number;
  saved_clip_bytes: number;
  cache_bytes: number;
  safe_delete_bytes: number;
  compression_candidate_bytes: number;
  trash_retention_days: number;
  unsynced_durable_count: number;
  recording_blocked: boolean;
  deficit_bytes: number;
  candidates: StorageCandidate[];
  sessions: Array<
    StorageCandidate & {
      state: SessionState;
      retention_class: RetentionClass;
      compression_state: CompressionState;
      sync_state: SyncState;
      source_size_bytes: number;
    }
  >;
}

export interface TrashedSession {
  id: string;
  deleted_at: string;
  purge_after: string;
  session: Omit<
    Session,
    | 'audio_url'
    | 'source_size_bytes'
    | 'actual_source_size_bytes'
    | 'clip_details'
    | 'waveform'
  >;
}

export interface TrashedClip {
  id: string;
  deleted_at: string;
  purge_after: string;
  source_state: TrashSourceState;
  clip: Omit<Clip, 'audio_url'>;
}

export type QueueFilter =
  | 'needs_review'
  | 'bookmarks'
  | 'clips'
  | 'archived'
  | 'safe_delete'
  | 'sync_problem'
  | 'all';
