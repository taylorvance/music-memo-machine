import {
  ArchiveRestore,
  AudioLines,
  Bookmark,
  Check,
  Crosshair,
  FastForward,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteClip, fetchClips, fetchSessions, fetchTrashedClips, fetchTrashedSessions, restoreClip, restoreSession, saveClip, updateSession } from "./api";
import type { Clip, Session, TrashedClip, TrashedSession } from "./types";

type Range = {
  start: number;
  end: number;
};

type RangeDragTarget = "select" | "start" | "end" | "move";

type RangeDragState = {
  target: RangeDragTarget;
  pointerId: number;
  anchorTime: number;
  anchorClientX: number;
  initialRange: Range;
  initialOffset: number;
  rectWidth: number;
};

const MIN_RANGE_SECONDS = 0.1;
const SELECT_DRAG_THRESHOLD_SECONDS = 0.2;
const PRECISION_DRAG_SCALE = 0.25;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundSeconds(seconds: number) {
  return Number(seconds.toFixed(2));
}

function inputSeconds(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatRangeInput(seconds: number) {
  return Math.round(seconds * 100) % 10 === 0 ? seconds.toFixed(1) : seconds.toFixed(2);
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

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function unresolvedBookmarkCount(session: Session) {
  return session.bookmarks.filter((bookmark) => bookmark.state === "unresolved").length;
}

function sessionPriority(session: Session) {
  if (unresolvedBookmarkCount(session) > 0) return 0;
  if (session.state === "unreviewed") return 1;
  if (session.clips.length > 0) return 2;
  return 3;
}

function defaultRange(session: Session): Range {
  const firstBookmark = session.bookmarks.find((bookmark) => bookmark.state === "unresolved") || session.bookmarks[0];
  if (!firstBookmark) {
    return { start: 0, end: Math.min(20, session.duration_seconds) };
  }

  return {
    start: clamp(firstBookmark.timestamp_seconds - 8, 0, session.duration_seconds),
    end: clamp(firstBookmark.timestamp_seconds + 12, 1, session.duration_seconds)
  };
}

function fakePeaks(duration: number) {
  return Array.from({ length: 140 }, (_, index) => {
    const t = index / 140;
    return Math.max(0.08, Math.abs(Math.sin(t * duration * 0.31)) * 0.55 + Math.abs(Math.sin(t * 13)) * 0.22);
  });
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [trashedSessions, setTrashedSessions] = useState<TrashedSession[]>([]);
  const [trashedClips, setTrashedClips] = useState<TrashedClip[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const priority = sessionPriority(a) - sessionPriority(b);
      if (priority !== 0) return priority;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [sessions]);

  const selectedSession = sortedSessions.find((session) => session.id === selectedId) || sortedSessions[0];
  const activeSessionIds = useMemo(() => new Set(sessions.map((session) => session.id)), [sessions]);
  const linkedClipIds = useMemo(() => new Set(sessions.flatMap((session) => session.clips)), [sessions]);
  const standaloneClips = useMemo(() => {
    return clips.filter((clip) => !activeSessionIds.has(clip.source_session_id) || !linkedClipIds.has(clip.id));
  }, [activeSessionIds, clips, linkedClipIds]);

  const reload = useCallback(async (preferredId?: string) => {
    const [next, nextClips, nextTrash, nextTrashedClips] = await Promise.all([fetchSessions(), fetchClips(), fetchTrashedSessions(), fetchTrashedClips()]);
    setSessions(next);
    setClips(nextClips);
    setTrashedSessions(nextTrash);
    setTrashedClips(nextTrashedClips);
    setSelectedId((current) => {
      const desired = preferredId || current;
      if (desired && next.some((session) => session.id === desired)) {
        return desired;
      }
      return next[0]?.id || "";
    });
  }, []);

  useEffect(() => {
    reload().catch((caught: Error) => setError(caught.message));
  }, [reload]);

  async function run(action: () => Promise<void>) {
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

  async function restoreTrashedSession(id: string) {
    const restored = await restoreSession(id);
    await reload(restored.session.id);
  }

  async function restoreTrashedClip(id: string) {
    const restored = await restoreClip(id);
    await reload(restored.session?.id || selectedId);
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p>Fixture review prototype</p>
          <h1>Music Memo Machine</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => run(() => reload(selectedId))} disabled={busy} title="Refresh">
          <RefreshCw size={18} />
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="layout">
        <aside className="queue" aria-label="Sessions">
          <h2>Sessions</h2>
          <div className="session-list">
            {sortedSessions.map((session) => (
              <button
                key={session.id}
                className={cx("session-row", session.id === selectedSession?.id && "selected")}
                type="button"
                onClick={() => setSelectedId(session.id)}
              >
                <span className="session-title">{session.id.replace("session-", "")}</span>
                <span className="session-meta">
                  {formatDate(session.created_at)} · {formatDuration(session.duration_seconds)}
                </span>
                <span className="session-tags">
                  {unresolvedBookmarkCount(session) > 0 ? <span>{unresolvedBookmarkCount(session)} bookmarks</span> : null}
                  {session.clips.length > 0 ? <span>{session.clips.length} clips</span> : null}
                  {session.state === "resolved" || session.state === "dismissed" ? <span>{session.state}</span> : null}
                </span>
              </button>
            ))}
          </div>
          {standaloneClips.length > 0 ? (
            <div className="memo-section" aria-label="Standalone memos">
              <div className="trash-header">
                <h2>Memos</h2>
                <span>{standaloneClips.length}</span>
              </div>
              <div className="memo-list">
                {standaloneClips.map((clip) => (
                  <div className="memo-row" key={clip.id}>
                    <div>
                      <strong>{clip.title || clip.id}</strong>
                      <span>
                        {formatDuration(clip.source_start_seconds)}-{formatDuration(clip.source_end_seconds)} · {activeSessionIds.has(clip.source_session_id) ? "source active" : "source unavailable"}
                      </span>
                    </div>
                    <audio controls src={clip.audio_url} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {trashedSessions.length + trashedClips.length > 0 ? (
            <div className="trash-section" aria-label="Recoverable items">
              <div className="trash-header">
                <h2>Trash</h2>
                <span>{trashedSessions.length + trashedClips.length}</span>
              </div>
              {trashedSessions.length > 0 ? (
                <div className="trash-list">
                  {trashedSessions.map((item) => (
                    <div className="trash-row" key={item.id}>
                      <div>
                        <strong>{item.id.replace("session-", "")}</strong>
                        <span>
                          {formatDuration(item.session.duration_seconds)} · purges {formatDate(item.purge_after)}
                        </span>
                      </div>
                      <button className="icon-button" type="button" onClick={() => run(() => restoreTrashedSession(item.id))} disabled={busy} title="Restore session">
                        <ArchiveRestore size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {trashedClips.length > 0 ? (
                <div className="trash-list removed-clips">
                  {trashedClips.map((item) => (
                    <div className="trash-row" key={item.id}>
                      <div>
                        <strong>{item.clip.title || item.id}</strong>
                        <span>
                          {formatDuration(item.clip.source_start_seconds)}-{formatDuration(item.clip.source_end_seconds)} · {item.source_state === "active" ? "source active" : item.source_state === "trashed" ? "source in trash" : "source unavailable"}
                        </span>
                      </div>
                      <button className="icon-button" type="button" onClick={() => run(() => restoreTrashedClip(item.id))} disabled={busy} title="Restore clip">
                        <AudioLines size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="review">
          {selectedSession ? (
            <ReviewSession
              session={selectedSession}
              busy={busy}
              onRun={run}
              onReload={() => reload(selectedSession.id)}
              onSessionUpdated={(updated) => {
                setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
              }}
            />
          ) : (
            <p className="empty">No sessions found. Run `npm run seed` to create fixtures.</p>
          )}
        </section>
      </section>
    </main>
  );
}

function ReviewSession({
  session,
  busy,
  onRun,
  onReload,
  onSessionUpdated
}: {
  session: Session;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onReload: () => Promise<void>;
  onSessionUpdated: (session: Session) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [range, setRange] = useState<Range>(() => defaultRange(session));
  const [precisionMode, setPrecisionMode] = useState(false);
  const [notes, setNotes] = useState(session.notes || "");
  const [clipTitle, setClipTitle] = useState("");

  useEffect(() => {
    const nextRange = defaultRange(session);
    setRange(nextRange);
    setNotes(session.notes || "");
    setClipTitle("");
    setCurrentTime(nextRange.start);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = nextRange.start;
    }
  }, [session.id]);

  function seek(seconds: number) {
    const next = clamp(seconds, 0, session.duration_seconds);
    setCurrentTime(next);
    if (audioRef.current) {
      audioRef.current.currentTime = next;
    }
  }

  async function togglePlayback() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    await audioRef.current.play();
    setIsPlaying(true);
  }

  function jumpBookmark(direction: "previous" | "next") {
    const sorted = [...session.bookmarks].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
    const next =
      direction === "next"
        ? sorted.find((bookmark) => bookmark.timestamp_seconds > currentTime + 0.2) || sorted[0]
        : [...sorted].reverse().find((bookmark) => bookmark.timestamp_seconds < currentTime - 0.2) || sorted[sorted.length - 1];

    if (next) {
      seek(next.timestamp_seconds);
    }
  }

  function jumpSeconds(seconds: number) {
    seek(currentTime + seconds);
  }

  async function saveSelectedClip() {
    await saveClip(session.id, {
      source_start_seconds: range.start,
      source_end_seconds: range.end,
      title: clipTitle,
      notes: "",
      bookmark_ids: session.bookmarks
        .filter((bookmark) => bookmark.timestamp_seconds >= range.start && bookmark.timestamp_seconds <= range.end)
        .map((bookmark) => bookmark.id)
    });
    await onReload();
  }

  async function deleteSavedClip(clipId: string) {
    if (!window.confirm("Delete this saved clip?")) return;
    const result = await deleteClip(clipId);
    if (result.session) {
      onSessionUpdated(result.session);
      return;
    }
    await onReload();
  }

  async function patchSession(patch: Parameters<typeof updateSession>[1]) {
    const updated = await updateSession(session.id, patch);
    onSessionUpdated(updated);
  }

  return (
    <div className="review-session">
      <audio
        ref={audioRef}
        src={session.audio_url}
        preload="metadata"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="review-header">
        <div>
          <h2>{session.id}</h2>
          <p>
            {formatDate(session.created_at)} · {formatDuration(session.duration_seconds)}
          </p>
        </div>
        <span className="state-pill">{session.state.replace("_", " ")}</span>
      </div>

      <Waveform
        session={session}
        currentTime={currentTime}
        range={range}
        precisionMode={precisionMode}
        onSeek={seek}
        onRangeChange={setRange}
        onPrecisionModeChange={setPrecisionMode}
      />

      <div className="transport">
        <button className="icon-button" type="button" onClick={() => jumpBookmark("previous")} disabled={session.bookmarks.length === 0} title="Previous bookmark">
          <SkipBack size={18} />
        </button>
        <button className="jump-button" type="button" onClick={() => jumpSeconds(-5)} disabled={currentTime <= 0} title="Back 5 seconds" aria-label="Back 5 seconds">
          <Rewind size={17} />
          <span>5s</span>
        </button>
        <button className="play-button" type="button" onClick={() => onRun(togglePlayback)} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button
          className="jump-button"
          type="button"
          onClick={() => jumpSeconds(5)}
          disabled={currentTime >= session.duration_seconds}
          title="Forward 5 seconds"
          aria-label="Forward 5 seconds"
        >
          <FastForward size={17} />
          <span>5s</span>
        </button>
        <button className="icon-button" type="button" onClick={() => jumpBookmark("next")} disabled={session.bookmarks.length === 0} title="Next bookmark">
          <SkipForward size={18} />
        </button>
        <span className="time">
          {formatDuration(currentTime)} / {formatDuration(session.duration_seconds)}
        </span>
      </div>

      <section className="simple-panel">
        <h3>Bookmarks</h3>
        {session.bookmarks.length > 0 ? (
          <div className="bookmark-list">
            {session.bookmarks.map((bookmark) => (
              <button key={bookmark.id} className={cx("bookmark-chip", bookmark.state !== "unresolved" && "muted")} type="button" onClick={() => seek(bookmark.timestamp_seconds)}>
                <Bookmark size={15} />
                {formatDuration(bookmark.timestamp_seconds)}
                {bookmark.state !== "unresolved" ? <span>{bookmark.state}</span> : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty compact">No bookmarks in this session.</p>
        )}
      </section>

      <section className="simple-panel">
        <h3>Save a clip</h3>
        <div className="range-row">
          <label>
            Start
            <input
              type="number"
              min={0}
              max={session.duration_seconds}
              step={precisionMode ? 0.05 : 0.1}
              value={formatRangeInput(range.start)}
              onChange={(event) =>
                setRange((current) => ({
                  ...current,
                  start: clamp(inputSeconds(event.target.value, current.start), 0, current.end - MIN_RANGE_SECONDS)
                }))
              }
            />
          </label>
          <label>
            End
            <input
              type="number"
              min={0}
              max={session.duration_seconds}
              step={precisionMode ? 0.05 : 0.1}
              value={formatRangeInput(range.end)}
              onChange={(event) =>
                setRange((current) => ({
                  ...current,
                  end: clamp(inputSeconds(event.target.value, current.end), current.start + MIN_RANGE_SECONDS, session.duration_seconds)
                }))
              }
            />
          </label>
          <button className="secondary-button" type="button" onClick={() => setRange({ start: 0, end: session.duration_seconds })}>
            Whole take
          </button>
        </div>
        <div className="clip-row">
          <input value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} placeholder="Optional clip title" />
          <button className="primary-button" type="button" onClick={() => onRun(saveSelectedClip)} disabled={busy || range.end <= range.start}>
            <Scissors size={16} />
            Save clip
          </button>
        </div>
      </section>

      <section className="simple-panel">
        <h3>Notes</h3>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        <button className="secondary-button fit" type="button" onClick={() => onRun(() => patchSession({ notes }))} disabled={busy}>
          <Save size={16} />
          Save notes
        </button>
      </section>

      {session.clip_details.length > 0 ? (
        <section className="simple-panel">
          <h3>Saved clips</h3>
          <div className="saved-clips">
            {session.clip_details.map((clip) => (
              <div className="saved-clip" key={clip.id}>
                <strong>{clip.title || clip.id}</strong>
                <span>
                  {formatDuration(clip.source_start_seconds)}-{formatDuration(clip.source_end_seconds)}
                </span>
                <audio controls src={clip.audio_url} />
                <button className="icon-button clip-delete-button" type="button" onClick={() => onRun(() => deleteSavedClip(clip.id))} disabled={busy} title="Delete clip">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="finish-row">
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            onRun(() =>
              patchSession({
                state: "resolved",
                retention_class: session.clips.length > 0 ? "archival_context" : "throwaway"
              })
            )
          }
          disabled={busy}
        >
          <Check size={16} />
          Done
        </button>
        <button
          className="danger-button"
          type="button"
          onClick={() => onRun(() => patchSession({ state: "dismissed", retention_class: "throwaway" }))}
          disabled={busy}
        >
          <Trash2 size={16} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Waveform({
  session,
  currentTime,
  range,
  precisionMode,
  onSeek,
  onRangeChange,
  onPrecisionModeChange
}: {
  session: Session;
  currentTime: number;
  range: Range;
  precisionMode: boolean;
  onSeek: (time: number) => void;
  onRangeChange: (range: Range) => void;
  onPrecisionModeChange: (enabled: boolean) => void;
}) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<RangeDragState | null>(null);
  const peaks = session.waveform?.peaks?.length ? session.waveform.peaks : fakePeaks(session.duration_seconds);

  function waveformRect() {
    return waveformRef.current?.getBoundingClientRect() || null;
  }

  function timeFromClientX(clientX: number) {
    const rect = waveformRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(((clientX - rect.left) / rect.width) * session.duration_seconds, 0, session.duration_seconds);
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, target: RangeDragTarget) {
    if (event.button !== 0) return;
    const rect = waveformRect();
    if (!rect || rect.width <= 0) return;
    const anchorTime = timeFromClientX(event.clientX);
    const initialOffset = clamp(anchorTime - range.start, 0, range.end - range.start);

    dragState.current = {
      target,
      pointerId: event.pointerId,
      anchorTime,
      anchorClientX: event.clientX,
      initialRange: range,
      initialOffset,
      rectWidth: rect.width
    };

    onSeek(target === "start" ? range.start : target === "end" ? range.end : anchorTime);
    waveformRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function rangeFromDrag(event: React.PointerEvent<HTMLDivElement>, state: RangeDragState) {
    if (state.target === "select") {
      const time = timeFromClientX(event.clientX);
      return {
        start: roundSeconds(Math.min(state.anchorTime, time)),
        end: roundSeconds(Math.max(state.anchorTime, time))
      };
    }

    const dragScale = precisionMode ? PRECISION_DRAG_SCALE : 1;
    const deltaSeconds = ((event.clientX - state.anchorClientX) / state.rectWidth) * session.duration_seconds * dragScale;

    if (state.target === "start") {
      return {
        start: roundSeconds(clamp(state.initialRange.start + deltaSeconds, 0, state.initialRange.end - MIN_RANGE_SECONDS)),
        end: state.initialRange.end
      };
    }

    if (state.target === "end") {
      return {
        start: state.initialRange.start,
        end: roundSeconds(clamp(state.initialRange.end + deltaSeconds, state.initialRange.start + MIN_RANGE_SECONDS, session.duration_seconds))
      };
    }

    const length = state.initialRange.end - state.initialRange.start;
    const start = roundSeconds(clamp(state.initialRange.start + deltaSeconds, 0, session.duration_seconds - length));
    return {
      start,
      end: roundSeconds(start + length)
    };
  }

  function seekRangeFocus(nextRange: Range, state: RangeDragState, pointerTime: number) {
    if (state.target === "start") {
      onSeek(nextRange.start);
      return;
    }
    if (state.target === "end") {
      onSeek(nextRange.end);
      return;
    }
    if (state.target === "move") {
      onSeek(clamp(nextRange.start + state.initialOffset, nextRange.start, nextRange.end));
      return;
    }
    onSeek(pointerTime);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startDrag(event, "select");
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const pointerTime = timeFromClientX(event.clientX);
    if (state.target === "select" && Math.abs(pointerTime - state.anchorTime) < SELECT_DRAG_THRESHOLD_SECONDS) return;
    const nextRange = rangeFromDrag(event, state);
    onRangeChange(nextRange);
    seekRangeFocus(nextRange, state, pointerTime);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const pointerTime = timeFromClientX(event.clientX);
    const nextRange = rangeFromDrag(event, state);
    if (state.target !== "select" || Math.abs(pointerTime - state.anchorTime) >= SELECT_DRAG_THRESHOLD_SECONDS) {
      onRangeChange(nextRange);
    }
    seekRangeFocus(nextRange, state, pointerTime);
    if (waveformRef.current?.hasPointerCapture(event.pointerId)) {
      waveformRef.current.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
  }

  function cancelDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (waveformRef.current?.hasPointerCapture(event.pointerId)) {
      waveformRef.current.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
  }

  function nudgeRange(target: "start" | "end", direction: -1 | 1) {
    const step = precisionMode ? 0.05 : 0.5;
    const delta = direction * step;
    if (target === "start") {
      const start = roundSeconds(clamp(range.start + delta, 0, range.end - MIN_RANGE_SECONDS));
      onRangeChange({ ...range, start });
      onSeek(start);
      return;
    }
    if (target === "end") {
      const end = roundSeconds(clamp(range.end + delta, range.start + MIN_RANGE_SECONDS, session.duration_seconds));
      onRangeChange({ ...range, end });
      onSeek(end);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>, target: "start" | "end") {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    nudgeRange(target, event.key === "ArrowLeft" ? -1 : 1);
  }

  const selectionLeft = (range.start / session.duration_seconds) * 100;
  const selectionWidth = ((range.end - range.start) / session.duration_seconds) * 100;

  return (
    <div className="waveform-wrap">
      <div
        ref={waveformRef}
        className="waveform"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      >
        <div className="bars" aria-hidden="true">
          {peaks.map((peak, index) => (
            <span key={`${session.id}-${index}`} style={{ height: `${Math.max(6, peak * 100)}%` }} />
          ))}
        </div>
        <div
          className="selection"
          style={{
            left: `${selectionLeft}%`,
            width: `${selectionWidth}%`
          }}
          onPointerDown={(event) => startDrag(event, "move")}
          title="Move selected range"
        >
          <button
            className="selection-handle start"
            type="button"
            aria-label="Adjust clip start"
            title="Adjust clip start"
            onPointerDown={(event) => startDrag(event, "start")}
            onKeyDown={(event) => handleKeyDown(event, "start")}
          />
          <button
            className="selection-handle end"
            type="button"
            aria-label="Adjust clip end"
            title="Adjust clip end"
            onPointerDown={(event) => startDrag(event, "end")}
            onKeyDown={(event) => handleKeyDown(event, "end")}
          />
        </div>
        <div className="playhead" style={{ left: `${(currentTime / session.duration_seconds) * 100}%` }} />
        {session.bookmarks.map((bookmark) => (
          <button
            key={bookmark.id}
            className={cx("marker", bookmark.state !== "unresolved" && "muted")}
            type="button"
            style={{ left: `${(bookmark.timestamp_seconds / session.duration_seconds) * 100}%` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSeek(bookmark.timestamp_seconds);
            }}
            title={`Bookmark at ${formatDuration(bookmark.timestamp_seconds)}`}
          >
            <Bookmark size={14} />
          </button>
        ))}
      </div>
      <div className="waveform-scale">
        <span>
          {formatDuration(range.start)}-{formatDuration(range.end)}
        </span>
        <button
          className={cx("fine-button", precisionMode && "active")}
          type="button"
          onClick={() => onPrecisionModeChange(!precisionMode)}
          aria-pressed={precisionMode}
          aria-label="Fine adjustment"
          title={precisionMode ? "Fine adjustment on" : "Fine adjustment"}
        >
          <Crosshair size={15} />
          <span>Fine</span>
        </button>
      </div>
    </div>
  );
}
