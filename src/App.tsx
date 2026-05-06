import {
  ArchiveRestore,
  AudioLines,
  Bookmark,
  Check,
  Crosshair,
  FastForward,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Rewind,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import {
  createStringCodec,
  createStringUnionCodec,
} from '@taylorvance/tv-shared-web/codecs';
import { useUrlState } from '@taylorvance/tv-shared-web/url-state';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteClip,
  fetchClips,
  fetchSessions,
  fetchTrashedClips,
  fetchTrashedSessions,
  restoreClip,
  restoreSession,
  saveClip,
  updateClip,
  updateSession,
} from './api';
import { RecorderEmulator } from './RecorderEmulator';
import type {
  BookmarkState,
  Clip,
  Session,
  TrashedClip,
  TrashedSession,
} from './types';

type Range = {
  start: number;
  end: number;
};

type RangeDragTarget = 'select' | 'start' | 'end' | 'move';
type AppMode = 'review' | 'emulator';
type BrowseMode = 'sessions' | 'clips';
type ReviewStatus = 'needs_review' | 'resolved' | 'dismissed';

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
const appModeCodec = createStringUnionCodec(['review', 'emulator']);
const browseModeCodec = createStringUnionCodec(['sessions', 'clips']);
const stringCodec = createStringCodec();

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
  return Math.round(seconds * 100) % 10 === 0
    ? seconds.toFixed(1)
    : seconds.toFixed(2);
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function sessionIndexLabel(session: Pick<Session, 'id'>) {
  return session.id.replace('session-', '');
}

function sessionDisplayTitle(session: Pick<Session, 'id' | 'title'>) {
  return session.title.trim() || sessionIndexLabel(session);
}

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function unresolvedBookmarkCount(session: Session) {
  return session.bookmarks.filter((bookmark) => bookmark.state === 'unresolved')
    .length;
}

function sessionPriority(session: Session) {
  if (unresolvedBookmarkCount(session) > 0) return 0;
  if (session.state === 'unreviewed') return 1;
  if (session.clips.length > 0) return 2;
  return 3;
}

function reviewStatus(session: Session): ReviewStatus {
  if (session.state === 'dismissed') return 'dismissed';
  if (session.state === 'unreviewed' || session.state === 'bookmarked')
    return 'needs_review';
  return 'resolved';
}

function defaultRange(session: Session): Range {
  const firstBookmark =
    session.bookmarks.find((bookmark) => bookmark.state === 'unresolved') ||
    session.bookmarks[0];
  if (!firstBookmark) {
    return { start: 0, end: Math.min(20, session.duration_seconds) };
  }

  return {
    start: clamp(
      firstBookmark.timestamp_seconds - 8,
      0,
      session.duration_seconds,
    ),
    end: clamp(
      firstBookmark.timestamp_seconds + 12,
      1,
      session.duration_seconds,
    ),
  };
}

function normalizedBookmarkState(state: BookmarkState) {
  return state === 'captured' ? 'resolved' : state;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [trashedSessions, setTrashedSessions] = useState<TrashedSession[]>([]);
  const [trashedClips, setTrashedClips] = useState<TrashedClip[]>([]);
  const [appMode, setAppMode] = useUrlState<AppMode>('mode', {
    codec: appModeCodec,
    defaultValue: 'review',
  });
  const [browseMode, setBrowseMode] = useUrlState<BrowseMode>('view', {
    codec: browseModeCodec,
    defaultValue: 'sessions',
  });
  const [selectedId, setSelectedId] = useUrlState('session', {
    codec: stringCodec,
    defaultValue: '',
  });
  const [focusedClipId, setFocusedClipId] = useUrlState('clip', {
    codec: stringCodec,
    defaultValue: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const priority = sessionPriority(a) - sessionPriority(b);
      if (priority !== 0) return priority;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [sessions]);

  const sortedClips = useMemo(() => {
    return [...clips].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }, [clips]);

  const selectedSession =
    sortedSessions.find((session) => session.id === selectedId) ||
    sortedSessions[0];
  const focusedClip =
    sortedClips.find((clip) => clip.id === focusedClipId) || null;
  const activeSessionIds = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  );

  const reload = useCallback(async (preferredId?: string) => {
    const [next, nextClips, nextTrash, nextTrashedClips] = await Promise.all([
      fetchSessions(),
      fetchClips(),
      fetchTrashedSessions(),
      fetchTrashedClips(),
    ]);
    setSessions(next);
    setClips(nextClips);
    setTrashedSessions(nextTrash);
    setTrashedClips(nextTrashedClips);
    setSelectedId((current) => {
      const desired = preferredId || current;
      if (desired && next.some((session) => session.id === desired)) {
        return desired;
      }
      return next[0]?.id || '';
    });
  }, []);

  useEffect(() => {
    reload().catch((caught: Error) => setError(caught.message));
  }, [reload]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
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

  function selectSession(sessionId: string) {
    setSelectedId(sessionId);
    setFocusedClipId('');
  }

  function selectClip(clip: Clip) {
    setFocusedClipId(clip.id);
    if (activeSessionIds.has(clip.source_session_id)) {
      setSelectedId(clip.source_session_id);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p>Review and recorder emulator</p>
          <h1>Music Memo Machine</h1>
        </div>
        <div className="topbar-actions">
          <div className="mode-tabs" role="tablist" aria-label="App mode">
            <button
              className={cx(appMode === 'review' && 'active')}
              type="button"
              role="tab"
              aria-selected={appMode === 'review'}
              onClick={() => setAppMode('review')}
            >
              <AudioLines size={17} />
              Review
            </button>
            <button
              className={cx(appMode === 'emulator' && 'active')}
              type="button"
              role="tab"
              aria-selected={appMode === 'emulator'}
              onClick={() => setAppMode('emulator')}
            >
              <Radio size={17} />
              Emulator
            </button>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => run(() => reload(selectedId))}
            disabled={busy}
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {appMode === 'emulator' ? (
        <RecorderEmulator
          onSessionImported={async (sessionId) => {
            await reload(sessionId);
            setSelectedId(sessionId);
            setBrowseMode('sessions');
          }}
          onReviewSession={(sessionId) => {
            setSelectedId(sessionId);
            setBrowseMode('sessions');
            setAppMode('review');
          }}
        />
      ) : (
        <section className="layout">
          <aside className="queue" aria-label="Library browser">
            <div
              className="browse-tabs"
              role="tablist"
              aria-label="Library browser"
            >
              <button
                className={cx(browseMode === 'sessions' && 'active')}
                type="button"
                onClick={() => setBrowseMode('sessions')}
                role="tab"
                aria-selected={browseMode === 'sessions'}
              >
                Sessions <span>{sortedSessions.length}</span>
              </button>
              <button
                className={cx(browseMode === 'clips' && 'active')}
                type="button"
                onClick={() => setBrowseMode('clips')}
                role="tab"
                aria-selected={browseMode === 'clips'}
              >
                Clips <span>{sortedClips.length}</span>
              </button>
            </div>
            {browseMode === 'sessions' ? (
              <div
                className="session-list"
                role="tabpanel"
                aria-label="Sessions"
              >
                {sortedSessions.map((session) => (
                  <button
                    key={session.id}
                    className={cx(
                      'session-row',
                      session.id === selectedSession?.id && 'selected',
                    )}
                    type="button"
                    onClick={() => selectSession(session.id)}
                  >
                    <span className="session-title">
                      {sessionDisplayTitle(session)}
                    </span>
                    <span className="session-meta">
                      {session.title.trim()
                        ? `${sessionIndexLabel(session)} · `
                        : ''}
                      {formatDate(session.created_at)} ·{' '}
                      {formatDuration(session.duration_seconds)}
                    </span>
                    <span className="session-tags">
                      {unresolvedBookmarkCount(session) > 0 ? (
                        <span>
                          {pluralize(
                            unresolvedBookmarkCount(session),
                            'bookmark',
                          )}
                        </span>
                      ) : null}
                      {session.clips.length > 0 ? (
                        <span>{pluralize(session.clips.length, 'clip')}</span>
                      ) : null}
                      {session.state === 'resolved' ||
                      session.state === 'dismissed' ? (
                        <span>{session.state}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="clip-list" role="tabpanel" aria-label="Clips">
                {sortedClips.length > 0 ? (
                  sortedClips.map((clip) => {
                    const sourceActive = activeSessionIds.has(
                      clip.source_session_id,
                    );
                    return (
                      <div
                        className={cx(
                          'clip-browse-row',
                          clip.id === focusedClipId && 'selected',
                        )}
                        key={clip.id}
                      >
                        <button
                          className="clip-browse-main"
                          type="button"
                          onClick={() => selectClip(clip)}
                          disabled={!sourceActive}
                        >
                          <strong>{clip.title || clip.id}</strong>
                          <span>
                            {formatDuration(clip.source_start_seconds)}-
                            {formatDuration(clip.source_end_seconds)} ·{' '}
                            {sourceActive
                              ? sessionIndexLabel({
                                  id: clip.source_session_id,
                                })
                              : 'source unavailable'}
                          </span>
                        </button>
                        <audio controls src={clip.audio_url} />
                      </div>
                    );
                  })
                ) : (
                  <p className="empty compact">No saved clips.</p>
                )}
              </div>
            )}
            {trashedSessions.length + trashedClips.length > 0 ? (
              <details className="trash-section" aria-label="Recoverable items">
                <summary className="trash-header">
                  <h2>Trash</h2>
                  <span>{trashedSessions.length + trashedClips.length}</span>
                </summary>
                {trashedSessions.length > 0 ? (
                  <div className="trash-list">
                    {trashedSessions.map((item) => (
                      <div className="trash-row" key={item.id}>
                        <div>
                          <strong>
                            {item.session.title ||
                              sessionIndexLabel({ id: item.id })}
                          </strong>
                          <span>
                            {formatDuration(item.session.duration_seconds)} ·
                            purges {formatDate(item.purge_after)}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() =>
                            run(() => restoreTrashedSession(item.id))
                          }
                          disabled={busy}
                          title="Restore session"
                        >
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
                            {formatDuration(item.clip.source_start_seconds)}-
                            {formatDuration(item.clip.source_end_seconds)} ·{' '}
                            {item.source_state === 'active'
                              ? 'source active'
                              : item.source_state === 'trashed'
                                ? 'source in trash'
                                : 'source unavailable'}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => run(() => restoreTrashedClip(item.id))}
                          disabled={busy}
                          title="Restore clip"
                        >
                          <AudioLines size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            ) : null}
          </aside>

          <section className="review">
            {selectedSession ? (
              <ReviewSession
                session={selectedSession}
                busy={busy}
                onRun={run}
                onReload={() => reload(selectedSession.id)}
                focusedClip={
                  focusedClip?.source_session_id === selectedSession.id
                    ? focusedClip
                    : null
                }
                onSessionUpdated={(updated) => {
                  setSessions((current) =>
                    current.map((session) =>
                      session.id === updated.id ? updated : session,
                    ),
                  );
                }}
              />
            ) : (
              <p className="empty">
                No sessions found. Run `npm run seed` to create fixtures.
              </p>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

function ReviewSession({
  session,
  busy,
  onRun,
  onReload,
  focusedClip,
  onSessionUpdated,
}: {
  session: Session;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onReload: () => Promise<void>;
  focusedClip: Clip | null;
  onSessionUpdated: (session: Session) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [range, setRange] = useState<Range>(() => defaultRange(session));
  const [precisionMode, setPrecisionMode] = useState(false);
  const [sessionTitle, setSessionTitle] = useState(session.title || '');
  const [notes, setNotes] = useState(session.notes || '');
  const [clipTitle, setClipTitle] = useState('');
  const [selectedBookmarkId, setSelectedBookmarkId] = useState('');

  useEffect(() => {
    const nextRange = defaultRange(session);
    setRange(nextRange);
    setSessionTitle(session.title || '');
    setNotes(session.notes || '');
    setClipTitle('');
    setSelectedBookmarkId('');
    setCurrentTime(nextRange.start);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = nextRange.start;
    }
  }, [session.id]);

  useEffect(() => {
    if (!focusedClip) return;
    const nextRange = {
      start: focusedClip.source_start_seconds,
      end: focusedClip.source_end_seconds,
    };
    setRange(nextRange);
    setSelectedBookmarkId('');
    seek(nextRange.start);
  }, [focusedClip?.id]);

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
    setSelectedBookmarkId('');
    await audioRef.current.play();
    setIsPlaying(true);
  }

  function jumpBookmark(direction: 'previous' | 'next') {
    const sorted = [...session.bookmarks].sort(
      (a, b) => a.timestamp_seconds - b.timestamp_seconds,
    );
    const next =
      direction === 'next'
        ? sorted.find(
            (bookmark) => bookmark.timestamp_seconds > currentTime + 0.2,
          ) || sorted[0]
        : [...sorted]
            .reverse()
            .find(
              (bookmark) => bookmark.timestamp_seconds < currentTime - 0.2,
            ) || sorted[sorted.length - 1];

    if (next) {
      setSelectedBookmarkId('');
      seek(next.timestamp_seconds);
    }
  }

  function jumpSeconds(seconds: number) {
    setSelectedBookmarkId('');
    seek(currentTime + seconds);
  }

  async function saveSelectedClip() {
    await saveClip(session.id, {
      source_start_seconds: range.start,
      source_end_seconds: range.end,
      title: clipTitle,
      notes: '',
    });
    await onReload();
  }

  async function deleteSavedClip(clipId: string) {
    if (!window.confirm('Remove this saved clip?')) return;
    const result = await deleteClip(clipId);
    if (result.session) {
      onSessionUpdated(result.session);
    }
    await onReload();
  }

  async function patchSession(patch: Parameters<typeof updateSession>[1]) {
    const updated = await updateSession(session.id, patch);
    onSessionUpdated(updated);
  }

  async function setBookmarkState(bookmarkId: string, state: BookmarkState) {
    await patchSession({
      bookmarks: session.bookmarks.map((bookmark) => ({
        ...bookmark,
        state:
          bookmark.id === bookmarkId
            ? state
            : normalizedBookmarkState(bookmark.state),
      })),
    });
  }

  function patchForStatus(
    status: ReviewStatus,
  ): Parameters<typeof updateSession>[1] {
    if (status === 'needs_review') {
      const hasReviewMarkers =
        session.bookmarks.length > 0 || session.clips.length > 0;
      return {
        state: hasReviewMarkers ? 'bookmarked' : 'unreviewed',
        retention_class: hasReviewMarkers ? 'review_pending' : 'throwaway',
      };
    }

    if (status === 'dismissed') {
      return { state: 'dismissed', retention_class: 'throwaway' };
    }

    const hasDurableContext =
      session.clips.length > 0 ||
      session.bookmarks.some((bookmark) => bookmark.state !== 'dismissed');
    return {
      state: 'resolved',
      retention_class: hasDurableContext ? 'archival_context' : 'throwaway',
    };
  }

  return (
    <div className="review-session">
      <audio
        ref={audioRef}
        src={session.audio_url}
        preload="metadata"
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <section className="session-panel">
        <div className="review-header">
          <div className="session-heading">
            <label>
              Title
              <input
                value={sessionTitle}
                onChange={(event) => setSessionTitle(event.target.value)}
                placeholder="Session title"
              />
            </label>
            <p>
              {sessionIndexLabel(session)} · {formatDate(session.created_at)} ·{' '}
              {formatDuration(session.duration_seconds)}
            </p>
          </div>
        </div>
        <div className="session-notes">
          <h3>Notes</h3>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
          />
          <button
            className="secondary-button fit"
            type="button"
            onClick={() =>
              onRun(() => patchSession({ title: sessionTitle, notes }))
            }
            disabled={busy}
          >
            <Save size={16} />
            Save session
          </button>
        </div>
        <div
          className="review-state-row"
          role="radiogroup"
          aria-label="Session state"
        >
          <span>Session state</span>
          <button
            className={cx(reviewStatus(session) === 'needs_review' && 'active')}
            type="button"
            role="radio"
            aria-checked={reviewStatus(session) === 'needs_review'}
            onClick={() =>
              onRun(() => patchSession(patchForStatus('needs_review')))
            }
            disabled={busy}
          >
            Needs review
          </button>
          <button
            className={cx(reviewStatus(session) === 'resolved' && 'active')}
            type="button"
            role="radio"
            aria-checked={reviewStatus(session) === 'resolved'}
            onClick={() =>
              onRun(() => patchSession(patchForStatus('resolved')))
            }
            disabled={busy}
          >
            Resolved
          </button>
          <button
            className={cx(
              reviewStatus(session) === 'dismissed' && 'active',
              'danger-choice',
            )}
            type="button"
            role="radio"
            aria-checked={reviewStatus(session) === 'dismissed'}
            onClick={() =>
              onRun(() => patchSession(patchForStatus('dismissed')))
            }
            disabled={busy}
          >
            Dismissed
          </button>
        </div>
      </section>

      <section className="clip-workbench">
        <Waveform
          session={session}
          currentTime={currentTime}
          range={range}
          precisionMode={precisionMode}
          busy={busy}
          selectedBookmarkId={selectedBookmarkId}
          onSeek={seek}
          onRangeChange={setRange}
          onPrecisionModeChange={setPrecisionMode}
          onBookmarkSelect={(bookmark) => {
            setSelectedBookmarkId(bookmark.id);
            seek(bookmark.timestamp_seconds);
          }}
          onBookmarkDismiss={() => setSelectedBookmarkId('')}
          onBookmarkStateChange={(bookmarkId, state) =>
            onRun(() => setBookmarkState(bookmarkId, state))
          }
        />

        <div className="clip-save-row">
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
                  start: clamp(
                    inputSeconds(event.target.value, current.start),
                    0,
                    current.end - MIN_RANGE_SECONDS,
                  ),
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
                  end: clamp(
                    inputSeconds(event.target.value, current.end),
                    current.start + MIN_RANGE_SECONDS,
                    session.duration_seconds,
                  ),
                }))
              }
            />
          </label>
          <input
            value={clipTitle}
            onChange={(event) => setClipTitle(event.target.value)}
            placeholder="Optional clip title"
          />
          <button
            className="primary-button"
            type="button"
            onClick={() => onRun(saveSelectedClip)}
            disabled={busy || range.end <= range.start}
          >
            <Scissors size={16} />
            Save clip
          </button>
        </div>

        <div className="transport">
          <button
            className="icon-button"
            type="button"
            onClick={() => jumpBookmark('previous')}
            disabled={session.bookmarks.length === 0}
            title="Previous bookmark"
          >
            <SkipBack size={18} />
          </button>
          <button
            className="jump-button"
            type="button"
            onClick={() => jumpSeconds(-5)}
            disabled={currentTime <= 0}
            title="Back 5 seconds"
            aria-label="Back 5 seconds"
          >
            <Rewind size={17} />
            <span>5s</span>
          </button>
          <button
            className="play-button"
            type="button"
            onClick={() => onRun(togglePlayback)}
            title={isPlaying ? 'Pause' : 'Play'}
          >
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
          <button
            className="icon-button"
            type="button"
            onClick={() => jumpBookmark('next')}
            disabled={session.bookmarks.length === 0}
            title="Next bookmark"
          >
            <SkipForward size={18} />
          </button>
          <span className="time">
            {formatDuration(currentTime)} /{' '}
            {formatDuration(session.duration_seconds)}
          </span>
        </div>
      </section>

      {session.clip_details.length > 0 ? (
        <section className="simple-panel">
          <h3>Saved clips</h3>
          <div className="saved-clips">
            {session.clip_details.map((clip) => (
              <SavedClipEditor
                clip={clip}
                busy={busy}
                key={clip.id}
                onRun={onRun}
                onReload={onReload}
                onDelete={deleteSavedClip}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SavedClipEditor({
  clip,
  busy,
  onRun,
  onReload,
  onDelete,
}: {
  clip: Clip;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onReload: () => Promise<void>;
  onDelete: (clipId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(clip.title || '');
  const [notes, setNotes] = useState(clip.notes || '');

  useEffect(() => {
    setTitle(clip.title || '');
    setNotes(clip.notes || '');
  }, [clip.id, clip.notes, clip.title]);

  async function saveEdits() {
    await updateClip(clip.id, { title, notes });
    await onReload();
  }

  return (
    <div className="saved-clip">
      <div className="saved-clip-fields">
        <input
          aria-label="Clip title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Clip title"
        />
        <textarea
          aria-label="Clip notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Clip notes"
        />
        <span>
          {formatDuration(clip.source_start_seconds)}-
          {formatDuration(clip.source_end_seconds)}
        </span>
      </div>
      <audio controls src={clip.audio_url} />
      <div className="saved-clip-actions">
        <button
          className="secondary-button fit"
          type="button"
          onClick={() => onRun(saveEdits)}
          disabled={busy}
        >
          <Save size={15} />
          Save
        </button>
        <button
          className="icon-button clip-delete-button"
          type="button"
          onClick={() => onRun(() => onDelete(clip.id))}
          disabled={busy}
          title="Remove clip"
        >
          <Trash2 size={16} />
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
  busy,
  selectedBookmarkId,
  onSeek,
  onRangeChange,
  onPrecisionModeChange,
  onBookmarkSelect,
  onBookmarkDismiss,
  onBookmarkStateChange,
}: {
  session: Session;
  currentTime: number;
  range: Range;
  precisionMode: boolean;
  busy: boolean;
  selectedBookmarkId: string;
  onSeek: (time: number) => void;
  onRangeChange: (range: Range) => void;
  onPrecisionModeChange: (enabled: boolean) => void;
  onBookmarkSelect: (bookmark: Session['bookmarks'][number]) => void;
  onBookmarkDismiss: () => void;
  onBookmarkStateChange: (bookmarkId: string, state: BookmarkState) => void;
}) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<RangeDragState | null>(null);
  const peaks = session.waveform?.peaks || [];

  useEffect(() => {
    if (!selectedBookmarkId) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('[data-bookmark-controls]')
      ) {
        return;
      }

      onBookmarkDismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onBookmarkDismiss, selectedBookmarkId]);

  function waveformRect() {
    return waveformRef.current?.getBoundingClientRect() || null;
  }

  function timeFromClientX(clientX: number) {
    const rect = waveformRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp(
      ((clientX - rect.left) / rect.width) * session.duration_seconds,
      0,
      session.duration_seconds,
    );
  }

  function startDrag(
    event: React.PointerEvent<HTMLElement>,
    target: RangeDragTarget,
  ) {
    if (event.button !== 0) return;
    const rect = waveformRect();
    if (!rect || rect.width <= 0) return;
    const anchorTime = timeFromClientX(event.clientX);
    const initialOffset = clamp(
      anchorTime - range.start,
      0,
      range.end - range.start,
    );

    dragState.current = {
      target,
      pointerId: event.pointerId,
      anchorTime,
      anchorClientX: event.clientX,
      initialRange: range,
      initialOffset,
      rectWidth: rect.width,
    };

    onBookmarkDismiss();
    onSeek(
      target === 'start'
        ? range.start
        : target === 'end'
          ? range.end
          : anchorTime,
    );
    waveformRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function rangeFromDrag(
    event: React.PointerEvent<HTMLDivElement>,
    state: RangeDragState,
  ) {
    if (state.target === 'select') {
      const time = timeFromClientX(event.clientX);
      return {
        start: roundSeconds(Math.min(state.anchorTime, time)),
        end: roundSeconds(Math.max(state.anchorTime, time)),
      };
    }

    const dragScale = precisionMode ? PRECISION_DRAG_SCALE : 1;
    const deltaSeconds =
      ((event.clientX - state.anchorClientX) / state.rectWidth) *
      session.duration_seconds *
      dragScale;

    if (state.target === 'start') {
      return {
        start: roundSeconds(
          clamp(
            state.initialRange.start + deltaSeconds,
            0,
            state.initialRange.end - MIN_RANGE_SECONDS,
          ),
        ),
        end: state.initialRange.end,
      };
    }

    if (state.target === 'end') {
      return {
        start: state.initialRange.start,
        end: roundSeconds(
          clamp(
            state.initialRange.end + deltaSeconds,
            state.initialRange.start + MIN_RANGE_SECONDS,
            session.duration_seconds,
          ),
        ),
      };
    }

    const length = state.initialRange.end - state.initialRange.start;
    const start = roundSeconds(
      clamp(
        state.initialRange.start + deltaSeconds,
        0,
        session.duration_seconds - length,
      ),
    );
    return {
      start,
      end: roundSeconds(start + length),
    };
  }

  function seekRangeFocus(
    nextRange: Range,
    state: RangeDragState,
    pointerTime: number,
  ) {
    if (state.target === 'start') {
      onSeek(nextRange.start);
      return;
    }
    if (state.target === 'end') {
      onSeek(nextRange.end);
      return;
    }
    if (state.target === 'move') {
      onSeek(
        clamp(
          nextRange.start + state.initialOffset,
          nextRange.start,
          nextRange.end,
        ),
      );
      return;
    }
    onSeek(pointerTime);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startDrag(event, 'select');
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const pointerTime = timeFromClientX(event.clientX);
    if (
      state.target === 'select' &&
      Math.abs(pointerTime - state.anchorTime) < SELECT_DRAG_THRESHOLD_SECONDS
    )
      return;
    const nextRange = rangeFromDrag(event, state);
    onRangeChange(nextRange);
    seekRangeFocus(nextRange, state, pointerTime);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const pointerTime = timeFromClientX(event.clientX);
    const nextRange = rangeFromDrag(event, state);
    if (
      state.target !== 'select' ||
      Math.abs(pointerTime - state.anchorTime) >= SELECT_DRAG_THRESHOLD_SECONDS
    ) {
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

  function nudgeRange(target: 'start' | 'end', direction: -1 | 1) {
    const step = precisionMode ? 0.05 : 0.5;
    const delta = direction * step;
    if (target === 'start') {
      const start = roundSeconds(
        clamp(range.start + delta, 0, range.end - MIN_RANGE_SECONDS),
      );
      onRangeChange({ ...range, start });
      onSeek(start);
      return;
    }
    if (target === 'end') {
      const end = roundSeconds(
        clamp(
          range.end + delta,
          range.start + MIN_RANGE_SECONDS,
          session.duration_seconds,
        ),
      );
      onRangeChange({ ...range, end });
      onSeek(end);
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    target: 'start' | 'end',
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    nudgeRange(target, event.key === 'ArrowLeft' ? -1 : 1);
  }

  const selectionLeft = (range.start / session.duration_seconds) * 100;
  const selectionWidth =
    ((range.end - range.start) / session.duration_seconds) * 100;

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
        {peaks.length ? (
          <div className="bars" aria-hidden="true">
            {peaks.map((peak, index) => (
              <span
                key={`${session.id}-${index}`}
                style={{ height: `${Math.max(6, peak * 100)}%` }}
              />
            ))}
          </div>
        ) : (
          <div className="waveform-empty">Waveform unavailable</div>
        )}
        <div
          className="selection"
          style={{
            left: `${selectionLeft}%`,
            width: `${selectionWidth}%`,
          }}
          onPointerDown={(event) => startDrag(event, 'move')}
          title="Move selected range"
        >
          <button
            className="selection-handle start"
            type="button"
            aria-label="Adjust clip start"
            title="Adjust clip start"
            onPointerDown={(event) => startDrag(event, 'start')}
            onKeyDown={(event) => handleKeyDown(event, 'start')}
          />
          <button
            className="selection-handle end"
            type="button"
            aria-label="Adjust clip end"
            title="Adjust clip end"
            onPointerDown={(event) => startDrag(event, 'end')}
            onKeyDown={(event) => handleKeyDown(event, 'end')}
          />
        </div>
        <div
          className="playhead"
          style={{ left: `${(currentTime / session.duration_seconds) * 100}%` }}
        />
        {session.clip_details.length > 0 ? (
          <div className="clip-bracket-layer" aria-label="Saved clip ranges">
            {session.clip_details.map((clip) => {
              const clipStart = clamp(
                clip.source_start_seconds,
                0,
                session.duration_seconds,
              );
              const clipEnd = clamp(
                clip.source_end_seconds,
                clipStart,
                session.duration_seconds,
              );
              const left = (clipStart / session.duration_seconds) * 100;
              const width =
                ((clipEnd - clipStart) / session.duration_seconds) * 100;
              const label = `${clip.title.trim() || 'Saved clip'} · ${formatDuration(clip.source_start_seconds)}-${formatDuration(clip.source_end_seconds)}`;

              return (
                <button
                  key={clip.id}
                  className="clip-bracket"
                  type="button"
                  aria-label={label}
                  title={label}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onBookmarkDismiss();
                    onRangeChange({
                      start: clip.source_start_seconds,
                      end: clip.source_end_seconds,
                    });
                    onSeek(clip.source_start_seconds);
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {session.bookmarks.map((bookmark) => {
          const bookmarkState = normalizedBookmarkState(bookmark.state);
          const left =
            (bookmark.timestamp_seconds / session.duration_seconds) * 100;
          const label = `Select bookmark at ${formatDuration(bookmark.timestamp_seconds)}`;

          return (
            <div key={bookmark.id}>
              <button
                className={cx(
                  'marker',
                  `marker-${bookmarkState}`,
                  bookmark.id === selectedBookmarkId && 'selected',
                )}
                data-bookmark-controls
                type="button"
                style={{ left: `${left}%` }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onBookmarkSelect(bookmark);
                }}
                aria-label={label}
                title={label}
              >
                <Bookmark size={14} />
              </button>
              {bookmark.id === selectedBookmarkId ? (
                <div
                  className="bookmark-popover"
                  data-bookmark-controls
                  style={{ left: `${clamp(left, 8, 92)}%` }}
                  role="toolbar"
                  aria-label={`Bookmark ${formatDuration(bookmark.timestamp_seconds)} state`}
                >
                  <button
                    className={cx(bookmarkState === 'unresolved' && 'active')}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onBookmarkStateChange(bookmark.id, 'unresolved');
                    }}
                    disabled={busy}
                    aria-label="Mark bookmark unresolved"
                    title="Unresolved"
                  >
                    <Bookmark size={14} />
                  </button>
                  <button
                    className={cx(bookmarkState === 'resolved' && 'active')}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onBookmarkStateChange(bookmark.id, 'resolved');
                    }}
                    disabled={busy}
                    aria-label="Mark bookmark resolved"
                    title="Resolved"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className={cx(
                      bookmarkState === 'dismissed' && 'active',
                      'danger-choice',
                    )}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onBookmarkStateChange(bookmark.id, 'dismissed');
                    }}
                    disabled={busy}
                    aria-label="Dismiss bookmark"
                    title="Dismissed"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="waveform-scale">
        <span>
          {formatDuration(range.start)}-{formatDuration(range.end)}
        </span>
        <button
          className={cx('fine-button', precisionMode && 'active')}
          type="button"
          onClick={() => onPrecisionModeChange(!precisionMode)}
          aria-pressed={precisionMode}
          aria-label="Fine adjustment"
          title={precisionMode ? 'Fine adjustment on' : 'Fine adjustment'}
        >
          <Crosshair size={15} />
          <span>Fine</span>
        </button>
      </div>
    </div>
  );
}
