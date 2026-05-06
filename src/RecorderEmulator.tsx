import {
  Bookmark,
  Check,
  Mic,
  Radio,
  RotateCcw,
  Square,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestSessionMultipart } from './api';

type EmulatorStatus =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'ready'
  | 'syncing'
  | 'synced'
  | 'failed';

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

function statusLabel(status: EmulatorStatus) {
  switch (status) {
    case 'arming':
      return 'Arming';
    case 'recording':
      return 'Recording';
    case 'ready':
      return 'Ready to sync';
    case 'syncing':
      return 'Syncing';
    case 'synced':
      return 'Synced';
    case 'failed':
      return 'Failed';
    case 'idle':
    default:
      return 'Idle';
  }
}

export function RecorderEmulator({
  onSessionImported,
  onReviewSession,
}: {
  onSessionImported: (sessionId: string) => Promise<void>;
  onReviewSession: (sessionId: string) => void;
}) {
  const [status, setStatus] = useState<EmulatorStatus>('idle');
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

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
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
      if (recording?.audioUrl) {
        URL.revokeObjectURL(recording.audioUrl);
      }
    };
  }, [recording?.audioUrl, stopCaptureNodes]);

  async function startRecording() {
    setError('');
    setStatus('arming');
    setRecording((current) => {
      if (current?.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
      }
      return null;
    });
    setBookmarks([]);
    setLastSessionId('');
    setElapsedSeconds(0);

    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      setStatus('failed');
      setError('Browser microphone recording is unavailable.');
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
      startedAtRef.current = performance.now();
      createdAtRef.current = new Date().toISOString();
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(
          roundSeconds((performance.now() - startedAtRef.current) / 1000),
        );
      }, 100);
      setStatus('recording');
    } catch (caught) {
      stopCaptureNodes();
      setStatus('failed');
      setError(
        caught instanceof Error
          ? caught.message
          : 'Microphone permission failed.',
      );
    }
  }

  function stopRecording() {
    if (status !== 'recording') return;

    const sampleRate = audioContextRef.current?.sampleRate || 48_000;
    stopCaptureNodes();
    const samples = mergeChunks(chunksRef.current);
    const wav = encodeWav(samples, sampleRate);
    const durationSeconds = roundSeconds(samples.length / sampleRate);
    const audioUrl = URL.createObjectURL(wav);
    const createdAt = createdAtRef.current || new Date().toISOString();

    setElapsedSeconds(durationSeconds);
    setRecording((current) => {
      if (current?.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
      }
      return {
        sessionId: createSessionId(deviceName, createdAt),
        wav,
        audioUrl,
        durationSeconds,
        sampleRate,
        createdAt,
      };
    });
    setStatus('ready');
  }

  function addBookmark() {
    if (status !== 'recording') return;
    const timestamp = roundSeconds(
      (performance.now() - startedAtRef.current) / 1000,
    );
    setBookmarks((current) => [
      ...current,
      {
        id: `bookmark-${String(current.length + 1).padStart(3, '0')}`,
        timestamp_seconds: timestamp,
        created_at: new Date().toISOString(),
        state: 'unresolved',
        note: '',
      },
    ]);
  }

  function updateBookmarkNote(id: string, note: string) {
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.id === id ? { ...bookmark, note } : bookmark,
      ),
    );
  }

  async function syncRecording() {
    if (!recording) return;
    setError('');
    setStatus('syncing');
    try {
      const createdAt = recording.createdAt;
      const result = await ingestSessionMultipart(
        {
          id: recording.sessionId,
          device_name: deviceName,
          created_at: createdAt,
          title,
          notes,
          bookmarks: bookmarks.map((bookmark) => ({
            ...bookmark,
            timestamp_seconds: Math.min(
              bookmark.timestamp_seconds,
              recording.durationSeconds,
            ),
          })),
        },
        recording.wav,
      );
      setLastSessionId(result.session_id);
      setStatus('synced');
      await onSessionImported(result.session_id);
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Sync failed.');
    }
  }

  function reset() {
    stopCaptureNodes();
    setStatus('idle');
    setElapsedSeconds(0);
    setBookmarks([]);
    setRecording((current) => {
      if (current?.audioUrl) {
        URL.revokeObjectURL(current.audioUrl);
      }
      return null;
    });
    setLastSessionId('');
    setError('');
  }

  const recordingActive = status === 'recording' || status === 'arming';
  const canSync = status === 'ready' || status === 'failed';

  return (
    <section className="emulator-shell" aria-label="Recorder emulator">
      <div className="emulator-board">
        <div className="emulator-status-strip">
          <div
            className={cx('status-light', status)}
            aria-label={`Recorder status: ${statusLabel(status)}`}
          />
          <strong>{statusLabel(status)}</strong>
          <span>{formatDuration(elapsedSeconds)}</span>
        </div>

        <div className="emulator-controls" aria-label="Recorder controls">
          {status === 'recording' ? (
            <button
              className="record-control stop"
              type="button"
              onClick={stopRecording}
              title="Stop"
            >
              <Square size={28} />
              Stop
            </button>
          ) : (
            <button
              className="record-control"
              type="button"
              onClick={startRecording}
              disabled={recordingActive || status === 'syncing'}
              title="Record"
            >
              <Mic size={30} />
              Record
            </button>
          )}
          <button
            className="emulator-action"
            type="button"
            onClick={addBookmark}
            disabled={status !== 'recording'}
            title="Bookmark"
          >
            <Bookmark size={22} />
            Bookmark
          </button>
          <button
            className="emulator-action primary"
            type="button"
            onClick={syncRecording}
            disabled={!canSync || !recording}
            title="Sync"
          >
            <Upload size={22} />
            Sync
          </button>
          <button
            className="emulator-action"
            type="button"
            onClick={reset}
            disabled={status === 'syncing'}
            title="Reset"
          >
            <RotateCcw size={21} />
            Reset
          </button>
        </div>

        {error ? <div className="emulator-error">{error}</div> : null}

        {recording ? (
          <div className="emulator-preview">
            <audio controls src={recording.audioUrl} />
            <div>
              <span>{formatDuration(recording.durationSeconds)}</span>
              <span>{recording.sampleRate} Hz WAV</span>
            </div>
          </div>
        ) : (
          <div className="emulator-meter" aria-hidden="true">
            <span className={cx(status === 'recording' && 'active')} />
            <span className={cx(status === 'recording' && 'active')} />
            <span className={cx(status === 'recording' && 'active')} />
            <span className={cx(status === 'recording' && 'active')} />
            <span className={cx(status === 'recording' && 'active')} />
          </div>
        )}
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
                  <input
                    aria-label={`Note for ${bookmark.id}`}
                    value={bookmark.note}
                    onChange={(event) =>
                      updateBookmarkNote(bookmark.id, event.target.value)
                    }
                    placeholder="Note"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="empty compact">No bookmarks.</p>
          )}
        </section>

        {lastSessionId ? (
          <section className="simple-panel emulator-synced">
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
          </section>
        ) : null}
      </aside>
    </section>
  );
}
