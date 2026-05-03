import {
  Bookmark,
  Check,
  Pause,
  Play,
  RefreshCw,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSessions, saveClip, updateSession } from "./api";
import type { Session } from "./types";

type Range = {
  start: number;
  end: number;
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

  const reload = useCallback(async (preferredId?: string) => {
    const next = await fetchSessions();
    setSessions(next);
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

      <Waveform session={session} currentTime={currentTime} range={range} onSeek={seek} onRangeChange={setRange} />

      <div className="transport">
        <button className="icon-button" type="button" onClick={() => jumpBookmark("previous")} disabled={session.bookmarks.length === 0} title="Previous bookmark">
          <SkipBack size={18} />
        </button>
        <button className="play-button" type="button" onClick={() => onRun(togglePlayback)} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
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
  onSeek,
  onRangeChange
}: {
  session: Session;
  currentTime: number;
  range: Range;
  onSeek: (time: number) => void;
  onRangeChange: (range: Range) => void;
}) {
  const dragStart = useRef<number | null>(null);
  const peaks = session.waveform?.peaks?.length ? session.waveform.peaks : fakePeaks(session.duration_seconds);

  function timeFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * session.duration_seconds, 0, session.duration_seconds);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const time = timeFromPointer(event);
    dragStart.current = time;
    onSeek(time);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    const time = timeFromPointer(event);
    if (Math.abs(time - dragStart.current) < 0.2) return;
    onRangeChange({
      start: Math.min(dragStart.current, time),
      end: Math.max(dragStart.current, time)
    });
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStart.current !== null) {
      onSeek(timeFromPointer(event));
    }
    dragStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="waveform-wrap">
      <div className="waveform" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
        <div className="bars" aria-hidden="true">
          {peaks.map((peak, index) => (
            <span key={`${session.id}-${index}`} style={{ height: `${Math.max(6, peak * 100)}%` }} />
          ))}
        </div>
        <div
          className="selection"
          style={{
            left: `${(range.start / session.duration_seconds) * 100}%`,
            width: `${((range.end - range.start) / session.duration_seconds) * 100}%`
          }}
        />
        <div className="playhead" style={{ left: `${(currentTime / session.duration_seconds) * 100}%` }} />
        {session.bookmarks.map((bookmark) => (
          <button
            key={bookmark.id}
            className={cx("marker", bookmark.state !== "unresolved" && "muted")}
            type="button"
            style={{ left: `${(bookmark.timestamp_seconds / session.duration_seconds) * 100}%` }}
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
        <span>Drag to select a range.</span>
        <span>
          {formatDuration(range.start)}-{formatDuration(range.end)}
        </span>
      </div>
    </div>
  );
}
