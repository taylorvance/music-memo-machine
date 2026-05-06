import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetadataStore } from '../server/metadata-store.js';
import { generateWaveformFromWavBuffer } from '../server/waveform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const libraryRoot = path.resolve(
  process.env.LIBRARY_DIR || path.join(projectRoot, 'library'),
);
const sampleRate = 16_000;
const channels = 1;
const bytesPerSample = 2;
const bytesPerSecond = sampleRate * channels * bytesPerSample;

const sessions = [
  {
    id: 'session-2026-05-02-001',
    created_at: '2026-05-02T09:12:00-05:00',
    duration_seconds: 28,
    state: 'unreviewed',
    retention_class: 'throwaway',
    compression_state: 'raw_wav',
    sync_state: 'local_only',
    notes: '',
    storage_size_bytes: 310 * 1024 * 1024,
    bookmarks: [],
    pattern: { base: 196, accent: 0.45, silences: [] },
  },
  {
    id: 'session-2026-04-11-002',
    created_at: '2026-04-11T20:30:00-05:00',
    duration_seconds: 95,
    state: 'unreviewed',
    retention_class: 'throwaway',
    compression_state: 'raw_wav',
    sync_state: 'local_only',
    notes: '',
    storage_size_bytes: 1450 * 1024 * 1024,
    bookmarks: [],
    pattern: {
      base: 147,
      accent: 0.25,
      silences: [
        [34, 46],
        [74, 81],
      ],
    },
  },
  {
    id: 'session-2026-05-02-003',
    created_at: '2026-05-02T11:48:00-05:00',
    duration_seconds: 64,
    state: 'bookmarked',
    retention_class: 'review_pending',
    compression_state: 'raw_wav',
    sync_state: 'pending_sync',
    notes: 'Left hand figure gets interesting after the bookmark.',
    storage_size_bytes: 760 * 1024 * 1024,
    bookmarks: [
      {
        id: 'bookmark-001',
        timestamp_seconds: 24.5,
        created_at: '2026-05-02T11:48:25-05:00',
        state: 'unresolved',
        note: '',
      },
    ],
    pattern: { base: 220, accent: 0.55, silences: [[51, 56]] },
  },
  {
    id: 'session-2026-05-01-004',
    created_at: '2026-05-01T22:04:00-05:00',
    duration_seconds: 88,
    state: 'bookmarked',
    retention_class: 'review_pending',
    compression_state: 'raw_wav',
    sync_state: 'local_only',
    notes: '',
    storage_size_bytes: 1100 * 1024 * 1024,
    bookmarks: [
      {
        id: 'bookmark-001',
        timestamp_seconds: 14.2,
        created_at: '2026-05-01T22:04:14-05:00',
        state: 'unresolved',
        note: 'Intro variation',
      },
      {
        id: 'bookmark-002',
        timestamp_seconds: 43.8,
        created_at: '2026-05-01T22:04:44-05:00',
        state: 'unresolved',
        note: '',
      },
      {
        id: 'bookmark-003',
        timestamp_seconds: 68.1,
        created_at: '2026-05-01T22:05:08-05:00',
        state: 'unresolved',
        note: 'Possible ending',
      },
    ],
    pattern: {
      base: 246.94,
      accent: 0.7,
      silences: [
        [30, 34],
        [59, 62],
      ],
    },
  },
  {
    id: 'session-2026-05-02-005',
    created_at: '2026-05-02T13:15:00-05:00',
    duration_seconds: 52,
    state: 'bookmarked',
    retention_class: 'review_pending',
    compression_state: 'raw_wav',
    sync_state: 'local_only',
    notes: 'Whole pass may be worth keeping.',
    storage_size_bytes: 610 * 1024 * 1024,
    bookmarks: [
      {
        id: 'bookmark-001',
        timestamp_seconds: 4.1,
        created_at: '2026-05-02T13:15:04-05:00',
        state: 'unresolved',
        note: 'Full take',
      },
    ],
    pattern: { base: 174.61, accent: 0.6, silences: [] },
  },
  {
    id: 'session-2026-04-30-006',
    created_at: '2026-04-30T18:06:00-05:00',
    duration_seconds: 76,
    state: 'bookmarked',
    retention_class: 'review_pending',
    compression_state: 'raw_wav',
    sync_state: 'sync_failed',
    notes: 'Lots of stop/start space around the useful sections.',
    storage_size_bytes: 890 * 1024 * 1024,
    bookmarks: [
      {
        id: 'bookmark-001',
        timestamp_seconds: 35.4,
        created_at: '2026-04-30T18:06:35-05:00',
        state: 'unresolved',
        note: '',
      },
      {
        id: 'bookmark-002',
        timestamp_seconds: 58.6,
        created_at: '2026-04-30T18:06:59-05:00',
        state: 'unresolved',
        note: '',
      },
    ],
    pattern: {
      base: 261.63,
      accent: 0.5,
      silences: [
        [8, 17],
        [28, 33],
        [49, 57],
        [68, 74],
      ],
    },
  },
  {
    id: 'session-2026-04-15-007',
    created_at: '2026-04-15T21:42:00-05:00',
    duration_seconds: 82,
    state: 'archival_context',
    retention_class: 'archival_context',
    compression_state: 'raw_wav',
    sync_state: 'pending_sync',
    notes: 'Already clipped; source stays around as context.',
    storage_size_bytes: 980 * 1024 * 1024,
    clips: ['clip-2026-04-15-001', 'clip-2026-04-15-002'],
    bookmarks: [
      {
        id: 'bookmark-001',
        timestamp_seconds: 22.5,
        created_at: '2026-04-15T21:42:23-05:00',
        state: 'resolved',
        note: 'Main riff',
      },
      {
        id: 'bookmark-002',
        timestamp_seconds: 61.8,
        created_at: '2026-04-15T21:43:02-05:00',
        state: 'resolved',
        note: 'Bridge sketch',
      },
    ],
    pattern: { base: 185, accent: 0.65, silences: [[39, 47]] },
  },
];

const clipFixtures = [
  {
    id: 'clip-2026-04-15-001',
    source_session_id: 'session-2026-04-15-007',
    source_start_seconds: 18,
    source_end_seconds: 38,
    audio_path: 'clip-2026-04-15-001.wav',
    created_at: '2026-04-15T22:03:00-05:00',
    title: 'Main riff memo',
    notes: '',
    sync_state: 'local_only',
    storage_size_bytes: 120 * 1024 * 1024,
  },
  {
    id: 'clip-2026-04-15-002',
    source_session_id: 'session-2026-04-15-007',
    source_start_seconds: 56,
    source_end_seconds: 72,
    audio_path: 'clip-2026-04-15-002.wav',
    created_at: '2026-04-15T22:09:00-05:00',
    title: 'Bridge sketch',
    notes: 'Could resolve down instead of up.',
    sync_state: 'synced',
    storage_size_bytes: 96 * 1024 * 1024,
  },
];

function ensurePcm16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
}

function isSilent(t, silences) {
  return silences.some(([start, end]) => t >= start && t <= end);
}

function envelopeAt(t, duration, pattern) {
  if (isSilent(t, pattern.silences || [])) {
    return 0.015;
  }
  const attack = Math.min(1, t / 2);
  const release = Math.min(1, (duration - t) / 2);
  const pulse = 0.65 + 0.35 * Math.sin(2 * Math.PI * t * pattern.accent);
  return 0.18 * attack * release * pulse;
}

function sampleAt(t, duration, pattern) {
  const phrase = Math.floor(t / 4) % 5;
  const pitchBend = [1, 1.125, 1.25, 1.5, 1.333][phrase];
  const frequency = pattern.base * pitchBend;
  const envelope = envelopeAt(t, duration, pattern);
  const fundamental = Math.sin(2 * Math.PI * frequency * t);
  const overtone = 0.32 * Math.sin(2 * Math.PI * frequency * 2.01 * t);
  const tremolo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 4.2 * t);
  return (fundamental + overtone) * envelope * tremolo;
}

function makeWav(duration, pattern) {
  const samples = Math.floor(duration * sampleRate);
  const dataSize = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(bytesPerSecond, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples; index += 1) {
    const t = index / sampleRate;
    buffer.writeInt16LE(
      ensurePcm16(sampleAt(t, duration, pattern)),
      44 + index * 2,
    );
  }

  return buffer;
}

function sliceWav(source, startSeconds, endSeconds) {
  const startByte = 44 + Math.floor(startSeconds * bytesPerSecond);
  const endByte = 44 + Math.floor(endSeconds * bytesPerSecond);
  const data = source.subarray(startByte, endByte);
  const header = Buffer.from(source.subarray(0, 44));

  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  await fs.rm(libraryRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(libraryRoot, 'sessions'), { recursive: true });
  await fs.mkdir(path.join(libraryRoot, 'clips'), { recursive: true });
  await fs.mkdir(path.join(libraryRoot, 'cache', 'waveforms'), {
    recursive: true,
  });

  const wavBySession = new Map();

  for (const fixture of sessions) {
    const sessionDir = path.join(libraryRoot, 'sessions', fixture.id);
    const wav = makeWav(fixture.duration_seconds, fixture.pattern);
    wavBySession.set(fixture.id, wav);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'source.wav'), wav);
    await writeJson(path.join(sessionDir, 'session.json'), {
      id: fixture.id,
      created_at: fixture.created_at,
      title: fixture.title || '',
      duration_seconds: fixture.duration_seconds,
      audio_path: 'source.wav',
      state: fixture.state,
      retention_class: fixture.retention_class,
      compression_state: fixture.compression_state,
      sync_state: fixture.sync_state,
      notes: fixture.notes,
      device_name: 'fixture room mic',
      sample_rate: sampleRate,
      channel_count: channels,
      storage_size_bytes: fixture.storage_size_bytes,
      bookmarks: fixture.bookmarks || [],
      clips: fixture.clips || [],
    });
    await writeJson(
      path.join(libraryRoot, 'cache', 'waveforms', `${fixture.id}.json`),
      generateWaveformFromWavBuffer(wav, fixture.id),
    );
  }

  for (const clip of clipFixtures) {
    const source = wavBySession.get(clip.source_session_id);
    await fs.writeFile(
      path.join(libraryRoot, 'clips', clip.audio_path),
      sliceWav(source, clip.source_start_seconds, clip.source_end_seconds),
    );
    await writeJson(path.join(libraryRoot, 'clips', `${clip.id}.json`), clip);
  }

  await writeJson(path.join(libraryRoot, 'storage-sim.json'), {
    as_of: '2026-05-02T22:00:00-05:00',
    total_bytes: 8 * 1024 * 1024 * 1024,
    simulated_free_bytes: 950 * 1024 * 1024,
    policy: {
      min_free_gb: 2,
      min_free_percent: 0.15,
      unbookmarked_retention_days: 14,
      unbookmarked_compression_days: 3,
      archival_compression_days: 30,
      lossy_only_throwaway: true,
    },
  });

  const store = createMetadataStore(libraryRoot);
  try {
    await store.importSidecarLibrary({ replace: true });
  } finally {
    store.close();
  }

  console.log(
    `Seeded ${sessions.length} sessions and ${clipFixtures.length} clips in ${libraryRoot}`,
  );
  console.log(`Metadata: ${path.join(libraryRoot, 'metadata.sqlite')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
