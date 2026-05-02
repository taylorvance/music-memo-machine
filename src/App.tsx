import {
  AlertTriangle,
  Archive,
  Bookmark,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Shield,
  SkipBack,
  SkipForward,
  Trash2,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compressCandidates,
  degradeThrowaways,
  deleteSafeSessions,
  fetchSessions,
  fetchStorage,
  saveClip,
  updateClip,
  updateSession,
  updateStorage
} from "./api";
import type {
  Bookmark as BookmarkType,
  BookmarkState,
  Clip,
  QueueFilter,
  RetentionClass,
  Session,
  SessionState,
  StorageCandidate,
  StorageSummary,
  SyncState
} from "./types";

type Range = {
  start: number;
  end: number;
};

const filters: Array<{ id: QueueFilter; label: string }> = [
  { id: "needs_review", label: "Needs review" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "clips", label: "Clips" },
  { id: "archived", label: "Archive" },
  { id: "safe_delete", label: "Safe delete" },
  { id: "sync_problem", label: "Sync" },
  { id: "all", label: "All" }
];

const stateLabel: Record<SessionState, string> = {
  unreviewed: "Unreviewed",
  bookmarked: "Bookmarked",
  resolved: "Resolved",
  dismissed: "Dismissed",
  archival_context: "Context"
};

const retentionLabel: Record<RetentionClass, string> = {
  throwaway: "Throwaway",
  review_pending: "Review",
  archival_context: "Context",
  protected: "Protected"
};

const syncLabel: Record<SyncState, string> = {
  local_only: "Local",
  pending_sync: "Pending",
  synced: "Synced",
  sync_failed: "Failed"
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function unresolvedBookmarks(session: Session) {
  return session.bookmarks.filter((bookmark) => bookmark.state === "unresolved");
}

function queuePriority(session: Session, candidate?: StorageCandidate) {
  if (unresolvedBookmarks(session).length > 0) return 0;
  if (session.state === "unreviewed") return 1;
  if (candidate?.safe_delete || candidate?.compression_candidate) return 2;
  if (session.state === "archival_context") return 3;
  return 4;
}

function matchesFilter(session: Session, filter: QueueFilter, candidate?: StorageCandidate) {
  switch (filter) {
    case "needs_review":
      return session.state === "unreviewed" || unresolvedBookmarks(session).length > 0;
    case "bookmarks":
      return session.bookmarks.length > 0;
    case "clips":
      return session.clips.length > 0;
    case "archived":
      return session.state === "archival_context" || session.retention_class === "archival_context";
    case "safe_delete":
      return Boolean(candidate?.safe_delete);
    case "sync_problem":
      return session.sync_state === "sync_failed" || session.clip_details.some((clip) => clip.sync_state === "sync_failed");
    case "all":
      return true;
  }
}

function fakePeaks(duration: number) {
  return Array.from({ length: 160 }, (_, index) => {
    const t = index / 160;
    return Math.max(0.08, Math.abs(Math.sin(t * duration * 0.31)) * 0.6 + Math.abs(Math.sin(t * 19)) * 0.24);
  });
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [filter, setFilter] = useState<QueueFilter>("needs_review");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (preferredId?: string) => {
    const [nextSessions, nextStorage] = await Promise.all([fetchSessions(), fetchStorage()]);
    setSessions(nextSessions);
    setStorage(nextStorage);
    setSelectedId((current) => {
      const desired = preferredId || current;
      if (desired && nextSessions.some((session) => session.id === desired)) {
        return desired;
      }
      return nextSessions[0]?.id || "";
    });
  }, []);

  useEffect(() => {
    reload().catch((caught: Error) => setError(caught.message));
  }, [reload]);

  const candidates = useMemo(() => new Map(storage?.candidates.map((candidate) => [candidate.id, candidate])), [storage]);

  const visibleSessions = useMemo(() => {
    return sessions
      .filter((session) => matchesFilter(session, filter, candidates.get(session.id)))
      .sort((a, b) => {
        const priority = queuePriority(a, candidates.get(a.id)) - queuePriority(b, candidates.get(b.id));
        if (priority !== 0) return priority;
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      });
  }, [candidates, filter, sessions]);

  useEffect(() => {
    if (visibleSessions.length === 0) return;
    if (!visibleSessions.some((session) => session.id === selectedId)) {
      setSelectedId(visibleSessions[0].id);
    }
  }, [selectedId, visibleSessions]);

  const selectedSession = sessions.find((session) => session.id === selectedId) || visibleSessions[0] || sessions[0];

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchSelected(session: Session, patch: Parameters<typeof updateSession>[1]) {
    const updated = await updateSession(session.id, patch);
    setSessions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStorage(await fetchStorage());
  }

  async function syncDurableItems() {
    const durableSessions = sessions.filter(
      (session) =>
        session.sync_state !== "synced" &&
        (session.retention_class === "archival_context" || session.retention_class === "protected" || session.bookmarks.length > 0)
    );
    const durableClips = sessions.flatMap((session) => session.clip_details).filter((clip) => clip.sync_state !== "synced");

    await Promise.all([
      ...durableSessions.map((session) => updateSession(session.id, { sync_state: "synced" })),
      ...durableClips.map((clip) => updateClip(clip.id, { sync_state: "synced" }))
    ]);
    await reload(selectedSession?.id);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Raspberry Pi music memo prototype</p>
          <h1>Music Memo Machine</h1>
        </div>
        <div className="topbar-status">
          <StatusPill tone={storage?.recording_blocked ? "danger" : "ok"} icon={storage?.recording_blocked ? AlertTriangle : CheckCircle2}>
            {storage?.recording_blocked ? "Recording blocked" : "Ready"}
          </StatusPill>
          <StatusPill tone="neutral" icon={HardDrive}>
            {storage ? `${formatBytes(storage.free_bytes)} free` : "Library"}
          </StatusPill>
          <button className="icon-button" type="button" onClick={() => runAction(() => reload(selectedId))} disabled={busy} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="queue-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Sessions</h2>
            </div>
            <span className="count-pill">{visibleSessions.length}</span>
          </div>

          <div className="filter-grid" role="tablist" aria-label="Session filters">
            {filters.map((item) => (
              <button
                key={item.id}
                className={cx("filter-button", filter === item.id && "active")}
                type="button"
                onClick={() => setFilter(item.id)}
              >
                <Filter size={14} />
                {item.label}
              </button>
            ))}
          </div>

          <div className="session-list">
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                candidate={candidates.get(session.id)}
                selected={session.id === selectedSession?.id}
                onSelect={() => setSelectedId(session.id)}
              />
            ))}
            {visibleSessions.length === 0 ? <div className="empty-state">No matching sessions</div> : null}
          </div>
        </aside>

        <section className="detail-panel">
          {selectedSession ? (
            <SessionDetail
              session={selectedSession}
              busy={busy}
              onBusyAction={runAction}
              onPatch={(patch) => patchSelected(selectedSession, patch)}
              onReload={() => reload(selectedSession.id)}
            />
          ) : (
            <div className="empty-state">No sessions loaded</div>
          )}
        </section>

        <aside className="storage-panel">
          {storage ? (
            <StoragePanel
              storage={storage}
              busy={busy}
              sessions={sessions}
              onBusyAction={runAction}
              onReload={() => reload(selectedSession?.id)}
              onSyncDurable={syncDurableItems}
            />
          ) : (
            <div className="empty-state">Loading storage</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function StatusPill({
  children,
  icon: Icon,
  tone
}: {
  children: React.ReactNode;
  icon: typeof CheckCircle2;
  tone: "ok" | "danger" | "neutral" | "warn";
}) {
  return (
    <span className={cx("status-pill", `tone-${tone}`)}>
      <Icon size={15} />
      {children}
    </span>
  );
}

function SessionRow({
  session,
  candidate,
  selected,
  onSelect
}: {
  session: Session;
  candidate?: StorageCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const unresolved = unresolvedBookmarks(session).length;
  return (
    <button className={cx("session-row", selected && "selected")} type="button" onClick={onSelect}>
      <span className="session-row-main">
        <span className="session-title">{session.id.replace("session-", "")}</span>
        <span className="session-meta">
          <Clock3 size={13} />
          {formatDate(session.created_at)}
          <span>{formatDuration(session.duration_seconds)}</span>
        </span>
      </span>
      <span className="session-badges">
        <span className={cx("badge", `state-${session.state}`)}>{stateLabel[session.state]}</span>
        {unresolved > 0 ? (
          <span className="badge badge-bookmark">
            <Bookmark size={12} />
            {unresolved}
          </span>
        ) : null}
        {session.clips.length > 0 ? <span className="badge badge-clip">{session.clips.length} clips</span> : null}
        {candidate?.safe_delete ? <span className="badge badge-delete">safe delete</span> : null}
      </span>
    </button>
  );
}

function SessionDetail({
  session,
  busy,
  onBusyAction,
  onPatch,
  onReload
}: {
  session: Session;
  busy: boolean;
  onBusyAction: (action: () => Promise<void>) => Promise<void>;
  onPatch: (patch: Parameters<typeof updateSession>[1]) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [range, setRange] = useState<Range>({ start: 0, end: Math.min(20, session.duration_seconds) });
  const [noteDraft, setNoteDraft] = useState(session.notes || "");
  const [clipTitle, setClipTitle] = useState("");
  const [clipNotes, setClipNotes] = useState("");

  useEffect(() => {
    const firstBookmark = unresolvedBookmarks(session)[0] || session.bookmarks[0];
    const start = firstBookmark ? clamp(firstBookmark.timestamp_seconds - 8, 0, session.duration_seconds) : 0;
    const end = firstBookmark ? clamp(firstBookmark.timestamp_seconds + 12, start + 1, session.duration_seconds) : Math.min(20, session.duration_seconds);
    setRange({ start, end });
    setCurrentTime(start);
    setNoteDraft(session.notes || "");
    setClipTitle("");
    setClipNotes("");
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = start;
    }
  }, [session.id]);

  function seek(seconds: number) {
    const next = clamp(seconds, 0, session.duration_seconds);
    if (audioRef.current) {
      audioRef.current.currentTime = next;
    }
    setCurrentTime(next);
  }

  async function togglePlayback() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      await audioRef.current.play();
      setIsPlaying(true);
    }
  }

  function jumpBookmark(direction: "previous" | "next") {
    const sorted = [...session.bookmarks].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
    const bookmark =
      direction === "next"
        ? sorted.find((item) => item.timestamp_seconds > currentTime + 0.2) || sorted[0]
        : [...sorted].reverse().find((item) => item.timestamp_seconds < currentTime - 0.2) || sorted[sorted.length - 1];
    if (bookmark) {
      seek(bookmark.timestamp_seconds);
    }
  }

  function setFullRange() {
    setRange({ start: 0, end: session.duration_seconds });
  }

  async function patchBookmark(bookmark: BookmarkType, patch: Partial<BookmarkType>) {
    const bookmarks = session.bookmarks.map((item) => (item.id === bookmark.id ? { ...item, ...patch } : item));
    await onPatch({ bookmarks });
  }

  async function saveSelectedClip() {
    const bookmarkIds = session.bookmarks
      .filter((bookmark) => bookmark.timestamp_seconds >= range.start && bookmark.timestamp_seconds <= range.end)
      .map((bookmark) => bookmark.id);
    await saveClip(session.id, {
      source_start_seconds: range.start,
      source_end_seconds: range.end,
      title: clipTitle,
      notes: clipNotes,
      bookmark_ids: bookmarkIds
    });
    await onReload();
  }

  async function setLifecycle(state: SessionState, retention_class: RetentionClass) {
    await onPatch({ state, retention_class });
  }

  async function setSync(sync_state: SyncState) {
    await onPatch({ sync_state });
  }

  return (
    <div className="session-detail">
      <audio
        ref={audioRef}
        src={session.audio_url}
        preload="metadata"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="detail-header">
        <div>
          <p className="eyebrow">Session</p>
          <h2>{session.id}</h2>
          <div className="detail-meta">
            <span>{formatDate(session.created_at)}</span>
            <span>{formatDuration(session.duration_seconds)}</span>
            <span>{formatBytes(session.source_size_bytes)}</span>
          </div>
        </div>
        <div className="detail-badges">
          <span className={cx("badge", `state-${session.state}`)}>{stateLabel[session.state]}</span>
          <span className="badge">{retentionLabel[session.retention_class]}</span>
          <span className={cx("badge", session.sync_state === "sync_failed" && "badge-danger")}>{syncLabel[session.sync_state]}</span>
        </div>
      </div>

      <Waveform
        session={session}
        currentTime={currentTime}
        range={range}
        onSeek={seek}
        onRangeChange={(next) => setRange({ start: clamp(next.start, 0, session.duration_seconds), end: clamp(next.end, 0, session.duration_seconds) })}
      />

      <div className="transport-row">
        <button className="icon-button" type="button" onClick={() => jumpBookmark("previous")} disabled={session.bookmarks.length === 0} title="Previous bookmark">
          <SkipBack size={18} />
        </button>
        <button className="primary-icon-button" type="button" onClick={() => onBusyAction(togglePlayback)} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="icon-button" type="button" onClick={() => jumpBookmark("next")} disabled={session.bookmarks.length === 0} title="Next bookmark">
          <SkipForward size={18} />
        </button>
        <span className="time-readout">
          {formatDuration(currentTime)} / {formatDuration(session.duration_seconds)}
        </span>
      </div>

      <div className="trim-panel">
        <div className="trim-inputs">
          <label>
            Start
            <input
              type="number"
              min={0}
              max={session.duration_seconds}
              step={0.1}
              value={range.start.toFixed(1)}
              onChange={(event) => setRange((current) => ({ ...current, start: clamp(Number(event.target.value), 0, current.end - 0.1) }))}
            />
          </label>
          <label>
            End
            <input
              type="number"
              min={0}
              max={session.duration_seconds}
              step={0.1}
              value={range.end.toFixed(1)}
              onChange={(event) => setRange((current) => ({ ...current, end: clamp(Number(event.target.value), current.start + 0.1, session.duration_seconds) }))}
            />
          </label>
          <button className="secondary-button" type="button" onClick={setFullRange}>
            <Scissors size={16} />
            Full range
          </button>
        </div>
        <div className="clip-form">
          <input type="text" value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} placeholder="Clip title" />
          <input type="text" value={clipNotes} onChange={(event) => setClipNotes(event.target.value)} placeholder="Clip notes" />
          <button className="primary-button" type="button" onClick={() => onBusyAction(saveSelectedClip)} disabled={busy || range.end <= range.start}>
            <Save size={16} />
            Save clip
          </button>
        </div>
      </div>

      <div className="two-column">
        <section className="detail-section">
          <div className="section-heading">
            <h3>Bookmarks</h3>
            <span className="count-pill">{session.bookmarks.length}</span>
          </div>
          <div className="bookmark-list">
            {session.bookmarks.map((bookmark) => (
              <BookmarkRow key={bookmark.id} bookmark={bookmark} onSeek={seek} onPatch={patchBookmark} />
            ))}
            {session.bookmarks.length === 0 ? <div className="empty-state compact">No bookmarks</div> : null}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-heading">
            <h3>Saved Clips</h3>
            <span className="count-pill">{session.clip_details.length}</span>
          </div>
          <div className="clip-list">
            {session.clip_details.map((clip) => (
              <ClipRow key={clip.id} clip={clip} onRefresh={onReload} />
            ))}
            {session.clip_details.length === 0 ? <div className="empty-state compact">No clips</div> : null}
          </div>
        </section>
      </div>

      <div className="notes-row">
        <label>
          Session notes
          <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={3} />
        </label>
        <button className="secondary-button align-end" type="button" onClick={() => onBusyAction(() => onPatch({ notes: noteDraft }))} disabled={busy}>
          <Save size={16} />
          Save notes
        </button>
      </div>

      <div className="action-strip">
        <button className="secondary-button" type="button" onClick={() => onBusyAction(() => setLifecycle("resolved", session.clips.length ? "archival_context" : "throwaway"))}>
          <Check size={16} />
          Resolve
        </button>
        <button className="secondary-button" type="button" onClick={() => onBusyAction(() => setLifecycle("archival_context", "archival_context"))}>
          <Archive size={16} />
          Archive
        </button>
        <button className="secondary-button" type="button" onClick={() => onBusyAction(() => setLifecycle(session.state, "protected"))}>
          <Shield size={16} />
          Keep
        </button>
        <button className="danger-button" type="button" onClick={() => onBusyAction(() => setLifecycle("dismissed", "throwaway"))}>
          <Trash2 size={16} />
          Dismiss
        </button>
        <div className="segmented sync-segment" aria-label="Sync state">
          {(["local_only", "pending_sync", "synced", "sync_failed"] satisfies SyncState[]).map((state) => (
            <button key={state} className={cx(session.sync_state === state && "active")} type="button" onClick={() => onBusyAction(() => setSync(state))}>
              {syncLabel[state]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Waveform({
  session,
  currentTime,
  range,
  onSeek,
  onRangeChange
}: {
  session: Session;
  currentTime: number;
  range: Range;
  onSeek: (time: number) => void;
  onRangeChange: (range: Range) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ start: number; moved: boolean } | null>(null);
  const peaks = session.waveform?.peaks?.length ? session.waveform.peaks : fakePeaks(session.duration_seconds);

  function timeFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return ratio * session.duration_seconds;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const time = timeFromPointer(event);
    dragRef.current = { start: time, moved: false };
    onSeek(time);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const time = timeFromPointer(event);
    if (Math.abs(time - dragRef.current.start) > 0.15) {
      dragRef.current.moved = true;
    }
    if (dragRef.current.moved) {
      onRangeChange({
        start: Math.min(dragRef.current.start, time),
        end: Math.max(dragRef.current.start, time)
      });
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      onSeek(timeFromPointer(event));
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const selectionLeft = (range.start / session.duration_seconds) * 100;
  const selectionWidth = ((range.end - range.start) / session.duration_seconds) * 100;
  const playhead = (currentTime / session.duration_seconds) * 100;

  return (
    <div className="waveform-wrap">
      <div
        ref={containerRef}
        className="waveform"
        role="slider"
        tabIndex={0}
        aria-label="Waveform seek and trim selection"
        aria-valuemin={0}
        aria-valuemax={session.duration_seconds}
        aria-valuenow={currentTime}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="waveform-bars" aria-hidden="true">
          {peaks.map((peak, index) => (
            <span key={`${session.id}-${index}`} style={{ height: `${Math.max(5, peak * 100)}%` }} />
          ))}
        </div>
        <div className="selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
        <div className="playhead" style={{ left: `${playhead}%` }} />
        {session.bookmarks.map((bookmark) => (
          <button
            key={bookmark.id}
            className={cx("bookmark-marker", `bookmark-${bookmark.state}`)}
            type="button"
            style={{ left: `${(bookmark.timestamp_seconds / session.duration_seconds) * 100}%` }}
            onClick={(event) => {
              event.stopPropagation();
              onSeek(bookmark.timestamp_seconds);
            }}
            title={`${bookmark.id} ${formatDuration(bookmark.timestamp_seconds)}`}
          >
            <Bookmark size={14} />
          </button>
        ))}
      </div>
      <div className="waveform-scale">
        <span>0:00</span>
        <span>{formatDuration(session.duration_seconds)}</span>
      </div>
    </div>
  );
}

function BookmarkRow({
  bookmark,
  onSeek,
  onPatch
}: {
  bookmark: BookmarkType;
  onSeek: (time: number) => void;
  onPatch: (bookmark: BookmarkType, patch: Partial<BookmarkType>) => Promise<void>;
}) {
  const [noteDraft, setNoteDraft] = useState(bookmark.note || "");
  const states: BookmarkState[] = ["unresolved", "captured", "dismissed"];

  useEffect(() => {
    setNoteDraft(bookmark.note || "");
  }, [bookmark.id, bookmark.note]);

  function saveNote() {
    if (noteDraft !== (bookmark.note || "")) {
      void onPatch(bookmark, { note: noteDraft });
    }
  }

  return (
    <div className="bookmark-row">
      <button className="bookmark-time" type="button" onClick={() => onSeek(bookmark.timestamp_seconds)}>
        <Bookmark size={15} />
        {formatDuration(bookmark.timestamp_seconds)}
      </button>
      <input
        value={noteDraft}
        onChange={(event) => setNoteDraft(event.target.value)}
        onBlur={saveNote}
        placeholder="Bookmark note"
      />
      <div className="segmented compact-segment">
        {states.map((state) => (
          <button key={state} className={cx(bookmark.state === state && "active")} type="button" onClick={() => void onPatch(bookmark, { state })}>
            {state}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClipRow({ clip, onRefresh }: { clip: Clip; onRefresh: () => Promise<void> }) {
  async function setSync(sync_state: SyncState) {
    await updateClip(clip.id, { sync_state });
    await onRefresh();
  }

  return (
    <div className="clip-row">
      <div>
        <div className="clip-title">{clip.title || clip.id}</div>
        <div className="session-meta">
          <Scissors size={13} />
          {formatDuration(clip.source_start_seconds)}-{formatDuration(clip.source_end_seconds)}
          <span>{formatBytes(clip.storage_size_bytes)}</span>
        </div>
      </div>
      <audio controls src={clip.audio_url} />
      <div className="segmented compact-segment">
        {(["local_only", "pending_sync", "synced", "sync_failed"] satisfies SyncState[]).map((state) => (
          <button key={state} className={cx(clip.sync_state === state && "active")} type="button" onClick={() => setSync(state)}>
            {syncLabel[state]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StoragePanel({
  storage,
  sessions,
  busy,
  onBusyAction,
  onReload,
  onSyncDurable
}: {
  storage: StorageSummary;
  sessions: Session[];
  busy: boolean;
  onBusyAction: (action: () => Promise<void>) => Promise<void>;
  onReload: () => Promise<void>;
  onSyncDurable: () => Promise<void>;
}) {
  const [freeDraft, setFreeDraft] = useState(storage.free_bytes);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const safeCandidates = storage.candidates.filter((candidate) => candidate.safe_delete);
  const compressionCandidates = storage.candidates.filter((candidate) => candidate.compression_candidate);
  const lossyCandidates = storage.candidates.filter((candidate) => candidate.lossy_candidate);
  const freeRatio = clamp(storage.free_bytes / storage.total_bytes, 0, 1);

  useEffect(() => {
    setFreeDraft(storage.free_bytes);
  }, [storage.free_bytes]);

  async function applyFreeSpace() {
    await updateStorage(freeDraft);
    await onReload();
  }

  async function deleteSafe() {
    await deleteSafeSessions();
    await onReload();
  }

  async function compress() {
    await compressCandidates();
    await onReload();
  }

  async function degrade() {
    await degradeThrowaways();
    await onReload();
  }

  return (
    <div className="storage-dashboard">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Lifecycle</p>
          <h2>Storage</h2>
        </div>
        <StatusPill tone={storage.recording_blocked ? "danger" : storage.free_bytes < storage.minimum_free_bytes ? "warn" : "ok"} icon={storage.recording_blocked ? XCircle : HardDrive}>
          {storage.recording_blocked ? "Blocked" : `${Math.round(freeRatio * 100)}% free`}
        </StatusPill>
      </div>

      <div className="storage-bar" aria-label="Storage free space">
        <span style={{ width: `${freeRatio * 100}%` }} />
      </div>

      <div className="metric-grid">
        <Metric label="Free" value={formatBytes(storage.free_bytes)} />
        <Metric label="Target" value={formatBytes(storage.minimum_free_bytes)} />
        <Metric label="Remaining" value={`${Math.floor(storage.estimated_recording_minutes / 60)}h ${storage.estimated_recording_minutes % 60}m`} />
        <Metric label="Unsynced" value={String(storage.unsynced_durable_count)} />
      </div>

      {storage.recording_blocked ? (
        <div className="blocking-box">
          <AlertTriangle size={18} />
          <span>Recording blocks until safe reclaim or sync frees enough space.</span>
        </div>
      ) : null}

      <div className="storage-slider">
        <label>
          Simulated free space
          <input
            type="range"
            min={0}
            max={storage.total_bytes}
            step={50 * 1024 * 1024}
            value={freeDraft}
            onChange={(event) => setFreeDraft(Number(event.target.value))}
          />
        </label>
        <button className="icon-button" type="button" onClick={() => onBusyAction(applyFreeSpace)} disabled={busy} title="Apply free space">
          <Check size={17} />
        </button>
      </div>

      <div className="storage-breakdown">
        <Metric label="Sources" value={formatBytes(storage.source_session_bytes)} />
        <Metric label="Context" value={formatBytes(storage.archival_context_bytes)} />
        <Metric label="Clips" value={formatBytes(storage.saved_clip_bytes)} />
        <Metric label="Cache" value={formatBytes(storage.cache_bytes)} />
      </div>

      <div className="storage-actions">
        <button className="secondary-button" type="button" onClick={() => onBusyAction(deleteSafe)} disabled={busy || safeCandidates.length === 0}>
          <Trash2 size={16} />
          Delete safe
        </button>
        <button className="secondary-button" type="button" onClick={() => onBusyAction(compress)} disabled={busy || compressionCandidates.length === 0}>
          <Archive size={16} />
          FLAC
        </button>
        <button className="secondary-button" type="button" onClick={() => onBusyAction(degrade)} disabled={busy || lossyCandidates.length === 0}>
          <Scissors size={16} />
          Lossy
        </button>
        <button className="secondary-button" type="button" onClick={() => onBusyAction(onSyncDurable)} disabled={busy || storage.unsynced_durable_count === 0}>
          <CheckCircle2 size={16} />
          Sync
        </button>
      </div>

      <CandidateList title="Safe Delete" candidates={safeCandidates} sessionById={sessionById} />
      <CandidateList title="Compression" candidates={compressionCandidates} sessionById={sessionById} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CandidateList({
  title,
  candidates,
  sessionById
}: {
  title: string;
  candidates: StorageCandidate[];
  sessionById: Map<string, Session>;
}) {
  return (
    <section className="candidate-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <span className="count-pill">{candidates.length}</span>
      </div>
      <div className="candidate-list">
        {candidates.slice(0, 4).map((candidate) => {
          const session = sessionById.get(candidate.id);
          return (
            <div className="candidate-row" key={candidate.id}>
              <span>{candidate.id.replace("session-", "")}</span>
              <strong>{formatBytes(candidate.size_bytes)}</strong>
              {session ? <em>{stateLabel[session.state]}</em> : null}
            </div>
          );
        })}
        {candidates.length === 0 ? <div className="empty-state compact">None</div> : null}
      </div>
    </section>
  );
}
