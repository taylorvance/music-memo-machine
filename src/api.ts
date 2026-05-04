import type { Clip, CompressionState, RetentionClass, Session, SessionState, StorageSummary, SyncState, TrashedClip, TrashedSession } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function fetchSessions() {
  return request<Session[]>("/api/sessions");
}

export function fetchClips() {
  return request<Clip[]>("/api/clips");
}

export function fetchStorage() {
  return request<StorageSummary>("/api/storage");
}

export function fetchTrashedClips() {
  return request<TrashedClip[]>("/api/trash/clips");
}

export function fetchTrashedSessions() {
  return request<TrashedSession[]>("/api/trash/sessions");
}

export function updateSession(
  id: string,
  patch: Partial<Pick<Session, "notes" | "bookmarks">> & {
    state?: SessionState;
    retention_class?: RetentionClass;
    compression_state?: CompressionState;
    sync_state?: SyncState;
  }
) {
  return request<Session>(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function saveClip(
  sessionId: string,
  input: {
    source_start_seconds: number;
    source_end_seconds: number;
    title: string;
    notes: string;
    bookmark_ids?: string[];
  }
) {
  return request<{ session: Session; clip: Clip }>(`/api/sessions/${sessionId}/clips`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateClip(id: string, patch: Partial<Pick<Clip, "title" | "notes" | "sync_state">>) {
  return request<Clip>(`/api/clips/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteClip(id: string) {
  return request<{ session: Session | null; deleted_clip_id: string; purge_after: string }>(`/api/clips/${id}`, {
    method: "DELETE"
  });
}

export function restoreClip(id: string) {
  return request<{ clip: Clip; session: Session | null; restored_clip_id: string; source_state: string }>(`/api/trash/clips/${id}/restore`, {
    method: "POST"
  });
}

export function restoreSession(id: string) {
  return request<{ session: Session; restored_session_id: string }>(`/api/trash/sessions/${id}/restore`, {
    method: "POST"
  });
}

export function updateStorage(freeBytes: number) {
  return request<StorageSummary>("/api/storage", {
    method: "PATCH",
    body: JSON.stringify({ free_bytes: freeBytes })
  });
}

export function deleteSafeSessions() {
  return request<{
    deleted_session_ids: string[];
    trashed_session_ids: string[];
    trashed_sessions: Array<{ id: string; purge_after: string }>;
    storage: StorageSummary;
  }>("/api/storage/delete-safe", {
    method: "POST"
  });
}

export function compressCandidates() {
  return request<{ compressed_session_ids: string[]; storage: StorageSummary }>("/api/storage/compress-candidates", {
    method: "POST"
  });
}

export function degradeThrowaways() {
  return request<{ degraded_session_ids: string[]; storage: StorageSummary }>("/api/storage/lossy-throwaways", {
    method: "POST"
  });
}
