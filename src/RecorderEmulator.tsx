import {
  Bookmark,
  Check,
  Mic,
  Radio,
} from 'lucide-react';
import { useShortcutRegistry } from '@taylorvance/tv-shared-web/shortcuts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestSessionMultipart } from './api';

type EmulatorStatus =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'syncing'
  | 'synced'
  | 'failed';

type SyncStatus = 'unconfigured' | 'synced' | 'syncing' | 'unsynced';

type RedStatus = 'off' | 'recording' | 'failed';

type EmulatorBookmark = {
  id: string;
  timestamp_seconds: number;
  created_at: string;
  state: 'unresolved';
  note: string;
};

type RecordingResult = {
  sessionId: string;
  wav: Blob;
  audioUrl: string;
  durationSeconds: number;
  sampleRate: number;
  createdAt: string;
};

type AudioContextConstructor = typeof AudioContext;

const bufferSize = 4096;
const statusVisibilitySeconds = 30;

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function roundSeconds(seconds: number) {
  return Number(seconds.toFixed(2));
}

function monotonicNow() {
  return performance.now();
}

function safeIdSegment(value: string) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || 'web-recorder-emulator';
}

function createSessionId(deviceName: string, createdAt: string) {
  const stamp = createdAt
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${safeIdSegment(deviceName)}-${stamp}-${suffix}`;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(offset, value, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function mergeChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function audioContextConstructor() {
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext
  );
}

function syncStatusLabel(status: SyncStatus) {
  switch (status) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing';
    case 'unsynced':
      return 'Unsynced';
    case 'unconfigured':
    default:
      return 'Sync off';
  }
}

function redLightLabel(status: RedStatus, visible: boolean) {
  if (!visible) return 'Asleep';
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'failed':
      return 'Error';
    case 'off':
    default:
      return 'Off';
  }
}

function blueLightLabel(status: SyncStatus, visible: boolean) {
  if (!visible) return 'Asleep';
  switch (status) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing';
    case 'unsynced':
      return 'Unsynced';
    case 'unconfigured':
    default:
      return 'Sync off';
  }
}

function isEmulatorTextTarget(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'audio, input, select, textarea, [contenteditable="true"], [role="textbox"]',
      ),
    )
  );
}

function isEmulatorFocusTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'audio, input, select, textarea, [contenteditable="true"], [role="textbox"]',
      ),
    )
  );
}

export function RecorderEmulator({
  onSessionImported,
  onReviewSession,
}: {
  onSessionImported: (sessionId: string) => Promise<void>;
  onReviewSession: (sessionId: string) => void;
}) {
  const [status, setStatus] = useState<EmulatorStatus>('idle');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [redStatus, setRedStatus] = useState<RedStatus>('off');
  const [statusVisible, setStatusVisible] = useState(true);
  const [pressedControl, setPressedControl] = useState<
    'record' | 'bookmark' | null
  >(null);
  const [deviceName, setDeviceName] = useState('web-recorder-emulator');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bookmarks, setBookmarks] = useState<EmulatorBookmark[]>([]);
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const [lastSessionId, setLastSessionId] = useState('');
  const [error, setError] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const startedAtRef = useRef(0);
  const createdAtRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const bookmarksRef = useRef<EmulatorBookmark[]>([]);
  const statusVisibilityTimerRef = useRef<number | null>(null);
  const syncRetryTimerRef = useRef<number | null>(null);

  const stopStatusVisibilityTimer = useCallback(() => {
    if (statusVisibilityTimerRef.current !== null) {
      window.clearTimeout(statusVisibilityTimerRef.current);
      statusVisibilityTimerRef.current = null;
    }
  }, []);

  const wakeStatusLights = useCallback(
    (recordingIsActive: boolean) => {
      stopStatusVisibilityTimer();
      setStatusVisible(true);
      if (!recordingIsActive) {
        statusVisibilityTimerRef.current = window.setTimeout(() => {
          setStatusVisible(false);
          statusVisibilityTimerRef.current = null;
        }, statusVisibilitySeconds * 1000);
      }
    },
    [stopStatusVisibilityTimer],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopSyncRetryTimer = useCallback(() => {
    if (syncRetryTimerRef.current !== null) {
      window.clearTimeout(syncRetryTimerRef.current);
      syncRetryTimerRef.current = null;
    }
  }, []);

  const stopCaptureNodes = useCallback(() => {
    stopTimer();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, [stopTimer]);

  useEffect(() => {
    return () => {
      stopCaptureNodes();
      stopStatusVisibilityTimer();
      stopSyncRetryTimer();
      if (recording?.audioUrl) {
        URL.revokeObjectURL(recording.audioUrl);
      }
    };
  }, [
    recording?.audioUrl,
    stopCaptureNodes,
    stopStatusVisibilityTimer,
    stopSyncRetryTimer,
  ]);

  useEffect(() => {
    statusVisibilityTimerRef.current = window.setTimeout(() => {
      setStatusVisible(false);
      statusVisibilityTimerRef.current = null;
    }, statusVisibilitySeconds * 1000);

    return stopStatusVisibilityTimer;
  }, [stopStatusVisibilityTimer]);

  useEffect(() => {
    if (redStatus !== 'failed') return undefined;

    const failureTimer = window.setTimeout(() => {
      setRedStatus(status === 'recording' ? 'recording' : 'off');
    }, 2500);

    return () => {
      window.clearTimeout(failureTimer);
    };
  }, [redStatus, status]);

  useEffect(() => {
    function clearPressedControl() {
      setPressedControl(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || isEmulatorTextTarget(event)) return;
      if (event.key.toLowerCase() === 'r') {
        setPressedControl('record');
      }
      if (event.key.toLowerCase() === 'b') {
        setPressedControl('bookmark');
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'r') {
        setPressedControl((current) => (current === 'record' ? null : current));
      }
      if (event.key.toLowerCase() === 'b') {
        setPressedControl((current) =>
          current === 'bookmark' ? null : current,
        );
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearPressedControl);
    document.addEventListener('visibilitychange', clearPressedControl);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearPressedControl);
      document.removeEventListener('visibilitychange', clearPressedControl);
    };
  }, []);

  async function startRecording() {
    wakeStatusLights(true);
    stopSyncRetryTimer();
    setError('');
    setStatus('arming');
    setRedStatus('off');
    setRecording((current) => {
      if (current?.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
      }
      return null;
    });
    bookmarksRef.current = [];
    setBookmarks([]);
    setLastSessionId('');
    setElapsedSeconds(0);

    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      setStatus('idle');
      setRedStatus('failed');
      setError('Browser microphone recording is unavailable.');
      wakeStatusLights(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(bufferSize, 1, 1);

      chunksRef.current = [];
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
      };

      source.connect(processor);
      processor.connect(context.destination);

      audioContextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;
      streamRef.current = stream;
      startedAtRef.current = monotonicNow();
      createdAtRef.current = new Date().toISOString();
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(
          roundSeconds((monotonicNow() - startedAtRef.current) / 1000),
        );
      }, 100);
      setStatus('recording');
      setRedStatus('recording');
    } catch (caught) {
      stopCaptureNodes();
      setStatus('idle');
      setRedStatus('failed');
      setError(
        caught instanceof Error
          ? caught.message
          : 'Microphone permission failed.',
      );
      wakeStatusLights(false);
    }
  }

  function stopRecording() {
    if (status !== 'recording') return;
    wakeStatusLights(false);

    const sampleRate = audioContextRef.current?.sampleRate || 48_000;
    stopCaptureNodes();
    const samples = mergeChunks(chunksRef.current);
    const wav = encodeWav(samples, sampleRate);
    const durationSeconds = roundSeconds(samples.length / sampleRate);
    const audioUrl = URL.createObjectURL(wav);
    const createdAt = createdAtRef.current || new Date().toISOString();
    const nextRecording = {
      sessionId: createSessionId(deviceName, createdAt),
      wav,
      audioUrl,
      durationSeconds,
      sampleRate,
      createdAt,
    };

    setElapsedSeconds(durationSeconds);
    setRecording((current) => {
      if (current?.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
      }
      return nextRecording;
    });
    setRedStatus('off');
    setStatus('syncing');
    stopSyncRetryTimer();
    void syncRecording(nextRecording);
  }

  function addBookmark() {
    wakeStatusLights(status === 'recording');
    if (status !== 'recording') return;
    const timestamp = roundSeconds(
      (monotonicNow() - startedAtRef.current) / 1000,
    );
    setBookmarks((current) => {
      const next = [
        ...current,
        {
          id: `bookmark-${String(current.length + 1).padStart(3, '0')}`,
          timestamp_seconds: timestamp,
          created_at: new Date().toISOString(),
          state: 'unresolved' as const,
          note: '',
        },
      ];
      bookmarksRef.current = next;
      return next;
    });
  }

  function importedBookmarks(durationSeconds: number) {
    return bookmarksRef.current.map((bookmark) => ({
      ...bookmark,
      timestamp_seconds: Math.min(bookmark.timestamp_seconds, durationSeconds),
    }));
  }

  function scheduleSyncRetry(recordingToSync: RecordingResult) {
    stopSyncRetryTimer();
    syncRetryTimerRef.current = window.setTimeout(() => {
      syncRetryTimerRef.current = null;
      void syncRecording(recordingToSync);
    }, 10_000);
  }

  async function syncRecording(recordingToSync: RecordingResult) {
    stopSyncRetryTimer();
    setError('');
    setSyncStatus('syncing');
    setStatus('syncing');
    wakeStatusLights(false);
    try {
      const createdAt = recordingToSync.createdAt;
      const result = await ingestSessionMultipart(
        {
          id: recordingToSync.sessionId,
          device_name: deviceName,
          created_at: createdAt,
          title,
          notes,
          bookmarks: importedBookmarks(recordingToSync.durationSeconds),
        },
        recordingToSync.wav,
      );
      setLastSessionId(result.session_id);
      setSyncStatus('synced');
      setStatus('synced');
      wakeStatusLights(false);
      await onSessionImported(result.session_id);
    } catch (caught) {
      setSyncStatus('unsynced');
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Sync failed.');
      scheduleSyncRetry(recordingToSync);
      wakeStatusLights(false);
    }
  }

  const recordingActive = status === 'recording' || status === 'arming';
  const hasPendingSync = Boolean(recording) && syncStatus !== 'synced';
  const { ref: emulatorShortcutRef } = useShortcutRegistry<HTMLElement>(
    [
      {
        id: 'toggle-recording',
        keys: 'r',
        label: 'Toggle recording',
        onTrigger: () => {
          if (status === 'recording') {
            stopRecording();
            return;
          }
          if (!recordingActive && status !== 'syncing' && !hasPendingSync) {
            void startRecording();
          }
        },
      },
      {
        id: 'add-bookmark',
        keys: 'b',
        label: 'Bookmark',
        onTrigger: addBookmark,
      },
    ],
    {
      hotkeys: {
        ignoreEventWhen: isEmulatorTextTarget,
        preventDefault: true,
      },
    },
  );

  return (
    <section
      ref={emulatorShortcutRef}
      className="emulator-shell"
      aria-label="Recorder emulator"
      tabIndex={-1}
      onPointerDown={(event) => {
        if (!isEmulatorFocusTarget(event.target)) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      <div className="emulator-board">
        <div className="emulator-status-strip">
          <div className="status-indicators" aria-label="Status lights">
            <div className="status-indicator">
              <div
                className={cx(
                  'status-light red',
                  statusVisible && redStatus,
                  !statusVisible && 'sleeping',
                )}
                aria-label={`Red recording LED: ${
                  statusVisible ? redStatus : 'sleeping'
                }`}
              />
              <span>
                <b>Record</b>
                <small>{redLightLabel(redStatus, statusVisible)}</small>
                <small>{formatDuration(elapsedSeconds)}</small>
              </span>
            </div>
            <div className="status-indicator">
              <div
                className={cx(
                  'status-light blue',
                  statusVisible && syncStatus,
                  !statusVisible && 'sleeping',
                )}
                aria-label={`Blue sync LED: ${
                  statusVisible ? syncStatusLabel(syncStatus) : 'sleeping'
                }`}
              />
              <span>
                <b>Sync</b>
                <small>{blueLightLabel(syncStatus, statusVisible)}</small>
              </span>
            </div>
          </div>
        </div>

        <div className="emulator-controls" aria-label="Recorder controls">
          {status === 'recording' ? (
            <button
              className={cx(
                'record-control',
                pressedControl === 'record' && 'pressed',
              )}
              type="button"
              onClick={stopRecording}
              aria-label="Stop recording"
              title="Stop recording"
            >
              <span className="emulator-button-icon">
                <Mic size={24} />
              </span>
            </button>
          ) : (
            <button
              className={cx(
                'record-control',
                pressedControl === 'record' && 'pressed',
              )}
              type="button"
              onClick={() => {
                wakeStatusLights(recordingActive);
                if (!recordingActive && status !== 'syncing' && !hasPendingSync) {
                  void startRecording();
                }
              }}
              aria-label="Record"
              title="Record"
            >
              <span className="emulator-button-icon">
                <Mic size={24} />
              </span>
            </button>
          )}
          <button
            className={cx(
              'emulator-action',
              pressedControl === 'bookmark' && 'pressed',
            )}
            type="button"
            onClick={addBookmark}
            aria-label="Bookmark"
            title="Bookmark"
          >
            <span className="emulator-button-icon">
              <Bookmark size={22} />
            </span>
          </button>
        </div>
        {error ? <div className="emulator-error">{error}</div> : null}
      </div>

      <aside className="emulator-side">
        <section className="simple-panel emulator-fields">
          <h2>Recorder</h2>
          <label>
            Device
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </label>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </label>
        </section>

        <section className="simple-panel emulator-bookmarks">
          <div className="emulator-panel-heading">
            <h2>Bookmarks</h2>
            <span>{bookmarks.length}</span>
          </div>
          {bookmarks.length > 0 ? (
            <div className="emulator-bookmark-list">
              {bookmarks.map((bookmark) => (
                <div className="emulator-bookmark-row" key={bookmark.id}>
                  <span>{formatDuration(bookmark.timestamp_seconds)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty compact">No bookmarks.</p>
          )}
        </section>

        {recording || lastSessionId ? (
          <section className="simple-panel emulator-synced">
            {recording ? (
              <div className="emulator-preview">
                <audio controls src={recording.audioUrl} />
                <span>{formatDuration(recording.durationSeconds)}</span>
                <span>{recording.sampleRate} Hz WAV</span>
              </div>
            ) : null}
            {lastSessionId ? (
              <>
                <div>
                  <Check size={19} />
                  <strong>{lastSessionId}</strong>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onReviewSession(lastSessionId)}
                >
                  <Radio size={18} />
                  Review take
                </button>
              </>
            ) : null}
          </section>
        ) : null}
      </aside>
    </section>
  );
}
