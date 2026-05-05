import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(projectRoot, 'scripts', 'recorder-emulator.mjs');
const libraryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'music-memo-machine-emulator-test-'),
);

process.env.NODE_ENV = 'test';
process.env.LIBRARY_DIR = libraryRoot;

const { app } = await import('../server/index.js');
const server = await listen(app);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await close(server);
  await fs.rm(libraryRoot, { recursive: true, force: true });
});

function listen(appInstance) {
  return new Promise((resolve, reject) => {
    const nextServer = http.createServer(appInstance);
    nextServer.once('error', reject);
    nextServer.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
}

function close(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  const body = await response.json();
  return { response, body };
}

async function runEmulator(args) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

test('emulator dry-run writes a reusable ingest payload', async () => {
  const payloadPath = path.join(libraryRoot, 'spool', 'dry-run-session.json');
  const result = await runEmulator([
    '--dry-run',
    '--json',
    '--id',
    'emulator-dry-run-001',
    '--device-name',
    'emulator test rig',
    '--duration',
    '0.8',
    '--bookmark',
    '0.2:first mark',
    '--write-payload',
    payloadPath,
  ]);

  assert.equal(result.submitted, false);
  assert.equal(result.session_id, 'emulator-dry-run-001');
  assert.equal(result.duration_seconds, 0.8);
  assert.equal(result.bookmark_count, 1);
  assert.equal(result.payload.id, 'emulator-dry-run-001');
  assert.equal(result.payload.bookmarks[0].note, 'first mark');
  assert.match(result.payload.audio.data_base64, /^[A-Za-z0-9+/]+=*$/);

  const payload = await readJson(payloadPath);
  assert.equal(payload.id, 'emulator-dry-run-001');
  assert.equal(payload.device_name, 'emulator test rig');
  assert.equal(payload.bookmarks[0].timestamp_seconds, 0.2);
});

test('emulator submits a saved payload through the manager ingestion endpoint', async () => {
  const payloadPath = path.join(libraryRoot, 'spool', 'saved-session.json');
  await runEmulator([
    '--dry-run',
    '--json',
    '--id',
    'emulator-payload-001',
    '--duration',
    '0.7',
    '--bookmark',
    '0.3:saved payload',
    '--write-payload',
    payloadPath,
  ]);

  const result = await runEmulator([
    '--json',
    '--payload',
    payloadPath,
    '--manager-url',
    baseUrl,
  ]);

  assert.equal(result.submitted, true);
  assert.equal(result.session_id, 'emulator-payload-001');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 201);
  assert.equal(result.results[0].imported, true);

  const { response, body } = await request('/api/sessions/emulator-payload-001');
  assert.equal(response.status, 200);
  assert.equal(body.device_name, 'recorder-emulator');
  assert.equal(body.bookmarks[0].note, 'saved payload');
});

test('emulator can submit the same recording twice to exercise duplicate acknowledgement', async () => {
  const result = await runEmulator([
    '--json',
    '--manager-url',
    baseUrl,
    '--id',
    'emulator-submit-001',
    '--device-name',
    'duplicate emulator',
    '--duration',
    '0.6',
    '--bookmark',
    '0.25:main idea',
    '--submit-count',
    '2',
  ]);

  assert.equal(result.submitted, true);
  assert.equal(result.session_id, 'emulator-submit-001');
  assert.deepEqual(
    result.results.map((item) => item.status),
    [201, 200],
  );
  assert.equal(result.results[0].imported, true);
  assert.equal(result.results[1].duplicate, true);

  const { response, body } = await request('/api/sessions/emulator-submit-001');
  assert.equal(response.status, 200);
  assert.equal(body.state, 'bookmarked');
  assert.equal(body.retention_class, 'review_pending');
  assert.equal(body.sync_state, 'synced');
  assert.equal(body.device_name, 'duplicate emulator');
  assert.equal(body.bookmarks.length, 1);
  assert.equal(body.bookmarks[0].timestamp_seconds, 0.25);
  assert.equal(body.bookmarks[0].note, 'main idea');
});
