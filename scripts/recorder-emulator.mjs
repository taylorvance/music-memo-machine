#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultManagerUrl = 'http://127.0.0.1:3001';
const defaultDeviceName = 'recorder-emulator';
const defaultDurationSeconds = 6;
const defaultSampleRate = 16_000;
const defaultChannelCount = 1;
const bytesPerSample = 2;
const thisFile = fileURLToPath(import.meta.url);

function usage() {
  return `Recorder emulator

Usage:
  npm run emulator:cli -- --duration 8 --bookmark 2.5 --bookmark 6:ending
  npm run emulator:cli -- --audio ./take.wav --bookmark 12 --title "Morning idea"
  npm run emulator:cli -- --dry-run --write-payload library/recorder-spool/demo.json
  npm run emulator:cli -- --payload library/recorder-spool/demo.json --submit-count 2

Options:
  --manager-url <url>       Manager base URL. Defaults to MANAGER_URL, RECORDER_MANAGER_URL, or ${defaultManagerUrl}.
  --id <id>                 Session id. Defaults to a generated safe id.
  --device-name <name>      Recorder device name. Defaults to DEVICE_NAME or ${defaultDeviceName}.
  --duration <seconds>      Generated recording duration. Defaults to ${defaultDurationSeconds}.
  --audio <path>            Use an existing WAV instead of generated audio.
  --bookmark <sec[:note]>   Add a bookmark. Repeat for multiple bookmarks.
  --title <text>            Imported session title.
  --notes <text>            Imported session notes.
  --payload <path>          Submit an existing ingest payload JSON.
  --write-payload <path>    Save the generated payload before syncing.
  --dry-run                 Build/write the payload without submitting it.
  --submit-count <count>    Submit the same payload multiple times to test duplicate ack behavior.
  --sync-attempts <count>   Retry transient sync failures this many times per submit. Defaults to 1.
  --retry-delay-ms <ms>     Delay between sync attempts. Defaults to 500.
  --json                    Print machine-readable JSON.
  --help                    Show this help.
`;
}

function cliError(message) {
  return Object.assign(new Error(message), { cli: true });
}

function readValue(argv, index, flag, inlineValue) {
  if (inlineValue !== undefined) {
    return { value: inlineValue, index };
  }
  const nextIndex = index + 1;
  if (nextIndex >= argv.length || argv[nextIndex].startsWith('--')) {
    throw cliError(`${flag} requires a value`);
  }
  return { value: argv[nextIndex], index: nextIndex };
}

function parsePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw cliError(`${label} must be a positive number`);
  }
  return number;
}

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw cliError(`${label} must be a positive integer`);
  }
  return number;
}

function parseNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw cliError(`${label} must be a non-negative number`);
  }
  return number;
}

function parseBookmark(value) {
  const separator = value.indexOf(':');
  const timestampRaw = separator === -1 ? value : value.slice(0, separator);
  const note = separator === -1 ? '' : value.slice(separator + 1);
  return {
    timestamp_seconds: parseNonNegativeNumber(
      timestampRaw,
      'bookmark timestamp',
    ),
    note,
  };
}

export function parseArgs(argv, env = process.env) {
  const options = {
    managerUrl:
      env.MANAGER_URL || env.RECORDER_MANAGER_URL || defaultManagerUrl,
    deviceName: env.DEVICE_NAME || defaultDeviceName,
    durationSeconds: defaultDurationSeconds,
    sampleRate: defaultSampleRate,
    channelCount: defaultChannelCount,
    bookmarks: [],
    title: '',
    notes: '',
    submitCount: 1,
    syncAttempts: 1,
    retryDelayMs: 500,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);

    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--manager-url': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.managerUrl = parsed.value;
        index = parsed.index;
        break;
      }
      case '--id': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.id = parsed.value;
        index = parsed.index;
        break;
      }
      case '--device-name': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.deviceName = parsed.value;
        index = parsed.index;
        break;
      }
      case '--duration': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.durationSeconds = parsePositiveNumber(
          parsed.value,
          '--duration',
        );
        index = parsed.index;
        break;
      }
      case '--audio': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.audioPath = parsed.value;
        index = parsed.index;
        break;
      }
      case '--bookmark': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.bookmarks.push(parseBookmark(parsed.value));
        index = parsed.index;
        break;
      }
      case '--title': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.title = parsed.value;
        index = parsed.index;
        break;
      }
      case '--note':
      case '--notes': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.notes = parsed.value;
        index = parsed.index;
        break;
      }
      case '--payload': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.payloadPath = parsed.value;
        index = parsed.index;
        break;
      }
      case '--write-payload': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.writePayloadPath = parsed.value;
        index = parsed.index;
        break;
      }
      case '--submit-count': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.submitCount = parsePositiveInteger(
          parsed.value,
          '--submit-count',
        );
        index = parsed.index;
        break;
      }
      case '--sync-attempts': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.syncAttempts = parsePositiveInteger(
          parsed.value,
          '--sync-attempts',
        );
        index = parsed.index;
        break;
      }
      case '--retry-delay-ms': {
        const parsed = readValue(argv, index, flag, inlineValue);
        options.retryDelayMs = parseNonNegativeNumber(
          parsed.value,
          '--retry-delay-ms',
        );
        index = parsed.index;
        break;
      }
      default:
        throw cliError(`Unknown option: ${arg}`);
    }
  }

  if (options.audioPath && options.payloadPath) {
    throw cliError('--audio cannot be used with --payload');
  }
  if (options.payloadPath && options.bookmarks.length > 0) {
    throw cliError('--bookmark cannot be used with --payload');
  }
  if (options.payloadPath && options.id) {
    throw cliError('--id cannot be used with --payload');
  }

  return options;
}

function safeIdSegment(value) {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return safe || defaultDeviceName;
}

function createSessionId(deviceName, now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${safeIdSegment(deviceName)}-${stamp}-${suffix}`;
}

function validateLibraryId(value, label) {
  if (typeof value !== 'string') {
    throw cliError(`${label} is required`);
  }
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)) {
    throw cliError(
      `${label} must use only letters, numbers, dot, underscore, or dash`,
    );
  }
  return id;
}

function findWavChunk(buffer, chunkId) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) {
      return null;
    }
    if (id === chunkId) {
      return { offset: dataOffset, size };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

function readWavInfo(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw cliError('Audio must be a WAV file');
  }

  const fmt = findWavChunk(buffer, 'fmt ');
  const data = findWavChunk(buffer, 'data');
  if (!fmt || !data) {
    throw cliError('WAV is missing fmt or data chunks');
  }

  const channelCount = buffer.readUInt16LE(fmt.offset + 2);
  const sampleRate = buffer.readUInt32LE(fmt.offset + 4);
  const byteRate = buffer.readUInt32LE(fmt.offset + 8);
  if (channelCount < 1 || sampleRate < 1 || byteRate < 1 || data.size < 1) {
    throw cliError('WAV has invalid stream metadata');
  }

  return {
    duration_seconds: Number((data.size / byteRate).toFixed(3)),
    sample_rate: sampleRate,
    channel_count: channelCount,
  };
}

function ensurePcm16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
}

function sampleAt(t, duration, baseFrequency) {
  const phrase = Math.floor(t / 2) % 4;
  const pitchBend = [1, 1.125, 1.333, 1.5][phrase];
  const frequency = baseFrequency * pitchBend;
  const attack = Math.min(1, t / 0.2);
  const release = Math.min(1, (duration - t) / 0.25);
  const pulse = 0.72 + 0.28 * Math.sin(2 * Math.PI * 1.6 * t);
  const fundamental = Math.sin(2 * Math.PI * frequency * t);
  const overtone = 0.28 * Math.sin(2 * Math.PI * frequency * 2.01 * t);
  return (fundamental + overtone) * 0.22 * attack * release * pulse;
}

function makeWav({
  durationSeconds,
  sampleRate = defaultSampleRate,
  channelCount = defaultChannelCount,
  baseFrequency = 220,
}) {
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const samples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const dataSize = samples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = sampleIndex / sampleRate;
    const value = ensurePcm16(sampleAt(t, durationSeconds, baseFrequency));
    for (let channel = 0; channel < channelCount; channel += 1) {
      buffer.writeInt16LE(
        value,
        44 + sampleIndex * blockAlign + channel * bytesPerSample,
      );
    }
  }

  return buffer;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function payloadAudio(payload) {
  const value = payload.audio?.data_base64 ?? payload.audio_base64;
  if (typeof value !== 'string') {
    throw cliError('Payload is missing audio.data_base64');
  }
  return Buffer.from(value, 'base64');
}

function bookmarkCreatedAt(recordingStartedAt, timestampSeconds) {
  return new Date(
    recordingStartedAt.getTime() + timestampSeconds * 1000,
  ).toISOString();
}

function buildBookmarks(bookmarks, durationSeconds, recordingStartedAt) {
  return bookmarks.map((bookmark, index) => {
    if (bookmark.timestamp_seconds > durationSeconds) {
      throw cliError(
        `bookmark ${bookmark.timestamp_seconds}s is outside ${durationSeconds}s recording`,
      );
    }
    return {
      id: `bookmark-${String(index + 1).padStart(3, '0')}`,
      timestamp_seconds: bookmark.timestamp_seconds,
      created_at: bookmarkCreatedAt(
        recordingStartedAt,
        bookmark.timestamp_seconds,
      ),
      state: 'unresolved',
      note: bookmark.note,
    };
  });
}

export async function buildPayload(options, now = new Date()) {
  if (options.payloadPath) {
    const payload = await readJson(path.resolve(options.payloadPath));
    readWavInfo(payloadAudio(payload));
    validateLibraryId(payload.id || payload.session_id, 'payload session id');
    return payload;
  }

  const audio = options.audioPath
    ? await fs.readFile(path.resolve(options.audioPath))
    : makeWav({
        durationSeconds: options.durationSeconds,
        sampleRate: options.sampleRate,
        channelCount: options.channelCount,
      });
  const wavInfo = readWavInfo(audio);
  const id = validateLibraryId(
    options.id || createSessionId(options.deviceName, now),
    'session id',
  );

  return {
    id,
    device_name: options.deviceName,
    created_at: now.toISOString(),
    title: options.title,
    notes: options.notes,
    audio: {
      data_base64: audio.toString('base64'),
    },
    bookmarks: buildBookmarks(options.bookmarks, wavInfo.duration_seconds, now),
  };
}

function normalizeManagerUrl(managerUrl) {
  const url = new URL(managerUrl);
  return url.toString().replace(/\/$/, '');
}

function ingestUrl(managerUrl) {
  return new URL('/api/ingest/sessions', normalizeManagerUrl(managerUrl));
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postPayload(managerUrl, payload) {
  const response = await fetch(ingestUrl(managerUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await parseResponseBody(response);
  if (!response.ok) {
    const message = body.error || `Manager rejected import: ${response.status}`;
    throw Object.assign(new Error(message), {
      status: response.status,
      body,
    });
  }
  return {
    status: response.status,
    body,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableSyncError(error) {
  return !error.status || error.status >= 500;
}

async function submitWithRetries(managerUrl, payload, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= options.syncAttempts; attempt += 1) {
    try {
      const result = await postPayload(managerUrl, payload);
      return {
        attempt,
        status: result.status,
        acknowledged: result.body.acknowledged === true,
        duplicate: result.body.duplicate === true,
        imported: result.body.imported === true,
        session_id: result.body.session_id,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableSyncError(error) || attempt === options.syncAttempts) {
        throw error;
      }
      await sleep(options.retryDelayMs);
    }
  }
  throw lastError;
}

function summarizePayload(payload) {
  const info = readWavInfo(payloadAudio(payload));
  return {
    session_id: payload.id || payload.session_id || payload.recorder_session_id,
    device_name: payload.device_name || '',
    duration_seconds: info.duration_seconds,
    sample_rate: info.sample_rate,
    channel_count: info.channel_count,
    audio_bytes: payloadAudio(payload).length,
    bookmark_count: Array.isArray(payload.bookmarks)
      ? payload.bookmarks.length
      : 0,
  };
}

export async function runEmulator(options) {
  const payload = await buildPayload(options);
  const payloadSummary = summarizePayload(payload);

  if (options.writePayloadPath) {
    await writeJson(path.resolve(options.writePayloadPath), payload);
  }

  if (options.dryRun) {
    return {
      ...payloadSummary,
      submitted: false,
      payload_path: options.writePayloadPath
        ? path.resolve(options.writePayloadPath)
        : undefined,
      payload,
    };
  }

  const managerUrl = normalizeManagerUrl(options.managerUrl);
  const results = [];
  for (let index = 0; index < options.submitCount; index += 1) {
    results.push(await submitWithRetries(managerUrl, payload, options));
  }

  return {
    ...payloadSummary,
    submitted: true,
    manager_url: managerUrl,
    payload_path: options.writePayloadPath
      ? path.resolve(options.writePayloadPath)
      : undefined,
    results,
  };
}

function printHuman(result) {
  console.log(`Recorder emulator session: ${result.session_id}`);
  console.log(`Duration: ${result.duration_seconds}s`);
  console.log(`Audio: ${result.audio_bytes} bytes WAV`);
  console.log(`Bookmarks: ${result.bookmark_count}`);
  if (result.payload_path) {
    console.log(`Payload: ${result.payload_path}`);
  }

  if (!result.submitted) {
    console.log('Dry run: no sync attempted');
    return;
  }

  for (const [index, item] of result.results.entries()) {
    const state = item.duplicate
      ? 'duplicate acknowledged'
      : item.imported
        ? 'imported'
        : 'acknowledged';
    console.log(
      `Sync ${index + 1}: ${state} (${item.status}, attempt ${item.attempt})`,
    );
  }
}

function errorSummary(error) {
  return {
    error: error.message || 'Recorder emulator failed',
    status: error.status,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const result = await runEmulator(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
  } catch (error) {
    if (options?.json) {
      console.error(JSON.stringify(errorSummary(error), null, 2));
    } else {
      console.error(error.message || error);
      if (error.cli) {
        console.error('Run with --help for usage.');
      }
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  await main();
}
