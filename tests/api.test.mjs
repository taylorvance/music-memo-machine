import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const libraryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'music-memo-machine-test-'),
);

process.env.NODE_ENV = 'test';
process.env.LIBRARY_DIR = libraryRoot;

await execFileAsync(
  process.execPath,
  [path.join(projectRoot, 'scripts', 'seed-fixtures.mjs')],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      LIBRARY_DIR: libraryRoot,
    },
  },
);

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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

test('health reports the seeded temp library', async () => {
  const { response, body } = await request('/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.seeded, true);
  assert.equal(body.library_root, libraryRoot);
  assert.equal(body.db_path, path.join(libraryRoot, 'metadata.sqlite'));
});

test('seed writes normalized SQLite metadata', async () => {
  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    assert.equal(
      db
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .some((row) => row.name === 'title'),
      true,
    );
    assert.equal(
      db
        .prepare('PRAGMA table_info(bookmarks)')
        .all()
        .some((row) => row.name === 'resulting_clip_id'),
      false,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
      7,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM bookmarks').get().count,
      9,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM bookmarks WHERE state = 'captured'",
        )
        .get().count,
      0,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM clips').get().count,
      2,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM session_clips').get().count,
      2,
    );
  } finally {
    db.close();
  }
});

test('seeded fixture sessions load with bookmarks, waveforms, and existing clips', async () => {
  const { response, body: sessions } = await request('/api/sessions');

  assert.equal(response.status, 200);
  assert.equal(sessions.length, 7);

  const bookmarked = sessions.find(
    (session) => session.id === 'session-2026-05-02-003',
  );
  assert.ok(bookmarked);
  assert.equal(bookmarked.bookmarks.length, 1);
  assert.equal(bookmarked.bookmarks[0].state, 'unresolved');
  assert.ok(bookmarked.waveform.peaks.length > 100);
  assert.equal(
    bookmarked.audio_url,
    '/media/sessions/session-2026-05-02-003/source.wav',
  );

  const clipped = sessions.find(
    (session) => session.id === 'session-2026-04-15-007',
  );
  assert.ok(clipped);
  assert.equal(clipped.clip_details.length, 2);
  assert.equal(
    clipped.clip_details[0].audio_url.startsWith('/media/clips/'),
    true,
  );
});

test('session title and notes updates persist to sidecar and SQLite', async () => {
  const { response, body } = await request(
    '/api/sessions/session-2026-05-02-001',
    {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Warmup motif',
        notes: 'Name this before review',
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(body.title, 'Warmup motif');
  assert.equal(body.notes, 'Name this before review');

  const sessionJson = await readJson(
    path.join(
      libraryRoot,
      'sessions',
      'session-2026-05-02-001',
      'session.json',
    ),
  );
  assert.equal(sessionJson.title, 'Warmup motif');
  assert.equal(sessionJson.notes, 'Name this before review');

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    const row = db
      .prepare('SELECT title, notes FROM sessions WHERE id = ?')
      .get('session-2026-05-02-001');
    assert.equal(row.title, 'Warmup motif');
    assert.equal(row.notes, 'Name this before review');
  } finally {
    db.close();
  }
});

test('clip title and notes updates persist to sidecar and SQLite', async () => {
  const { response, body } = await request('/api/clips/clip-2026-04-15-001', {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Tighter riff',
      notes: 'Use second ending',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.title, 'Tighter riff');
  assert.equal(body.notes, 'Use second ending');

  const clipJson = await readJson(
    path.join(libraryRoot, 'clips', 'clip-2026-04-15-001.json'),
  );
  assert.equal(clipJson.title, 'Tighter riff');
  assert.equal(clipJson.notes, 'Use second ending');

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    const row = db
      .prepare('SELECT title, notes FROM clips WHERE id = ?')
      .get('clip-2026-04-15-001');
    assert.equal(row.title, 'Tighter riff');
    assert.equal(row.notes, 'Use second ending');
  } finally {
    db.close();
  }
});

test('saving a clip writes copied audio, clip metadata, and archival source state', async () => {
  const { response, body } = await request(
    '/api/sessions/session-2026-05-02-003/clips',
    {
      method: 'POST',
      body: JSON.stringify({
        source_start_seconds: 20,
        source_end_seconds: 30,
        title: 'Test clip',
        notes: 'Created by integration test',
      }),
    },
  );

  assert.equal(response.status, 201);
  assert.equal(body.clip.title, 'Test clip');
  assert.equal(body.clip.source_session_id, 'session-2026-05-02-003');
  assert.equal(body.session.state, 'archival_context');
  assert.equal(body.session.retention_class, 'archival_context');
  assert.equal(body.session.bookmarks[0].state, 'resolved');
  assert.equal('resulting_clip_id' in body.session.bookmarks[0], false);
  assert.equal(body.session.clips.includes(body.clip.id), true);

  const clipAudioPath = path.join(libraryRoot, 'clips', body.clip.audio_path);
  const clipJsonPath = path.join(libraryRoot, 'clips', `${body.clip.id}.json`);
  const sessionJsonPath = path.join(
    libraryRoot,
    'sessions',
    'session-2026-05-02-003',
    'session.json',
  );
  const clipAudio = await fs.readFile(clipAudioPath);
  const clipJson = await readJson(clipJsonPath);
  const sessionJson = await readJson(sessionJsonPath);

  assert.equal(clipAudio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(clipAudio.toString('ascii', 8, 12), 'WAVE');
  assert.equal(clipJson.id, body.clip.id);
  assert.equal(sessionJson.clips.includes(body.clip.id), true);

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    assert.equal(
      db.prepare('SELECT title FROM clips WHERE id = ?').get(body.clip.id)
        .title,
      'Test clip',
    );
    assert.equal(
      db
        .prepare('SELECT state FROM sessions WHERE id = ?')
        .get('session-2026-05-02-003').state,
      'archival_context',
    );
    assert.equal(
      db
        .prepare('SELECT state FROM bookmarks WHERE session_id = ? AND id = ?')
        .get('session-2026-05-02-003', 'bookmark-001').state,
      'resolved',
    );
  } finally {
    db.close();
  }
});

test('saving a clip resolves a nearby trailing bookmark without including it in the clipped audio', async () => {
  const { response, body } = await request(
    '/api/sessions/session-2026-05-01-004/clips',
    {
      method: 'POST',
      body: JSON.stringify({
        source_start_seconds: 34,
        source_end_seconds: 42,
        title: 'Late bookmark trim',
        notes: '',
      }),
    },
  );

  const resolved = body.session.bookmarks.find(
    (bookmark) => bookmark.id === 'bookmark-002',
  );
  const unrelated = body.session.bookmarks.find(
    (bookmark) => bookmark.id === 'bookmark-003',
  );

  assert.equal(response.status, 201);
  assert.equal(body.clip.source_start_seconds, 34);
  assert.equal(body.clip.source_end_seconds, 42);
  assert.equal(resolved.timestamp_seconds > body.clip.source_end_seconds, true);
  assert.equal(resolved.state, 'resolved');
  assert.equal('resulting_clip_id' in resolved, false);
  assert.equal(unrelated.state, 'unresolved');
});

test('deleting and restoring a clip moves files without owning source bookmark resolution', async () => {
  const created = await request('/api/sessions/session-2026-05-02-005/clips', {
    method: 'POST',
    body: JSON.stringify({
      source_start_seconds: 2,
      source_end_seconds: 9,
      title: 'Undo me',
      notes: '',
    }),
  });

  const clip = created.body.clip;
  const clipAudioPath = path.join(libraryRoot, 'clips', clip.audio_path);
  const clipJsonPath = path.join(libraryRoot, 'clips', `${clip.id}.json`);
  await fs.access(clipAudioPath);
  await fs.access(clipJsonPath);

  const { response, body } = await request(`/api/clips/${clip.id}`, {
    method: 'DELETE',
  });

  assert.equal(response.status, 200);
  assert.equal(body.deleted_clip_id, clip.id);
  assert.match(body.purge_after, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.session.clips.includes(clip.id), false);
  assert.equal(
    body.session.clip_details.some((item) => item.id === clip.id),
    false,
  );
  assert.equal(body.session.state, 'resolved');
  assert.equal(body.session.retention_class, 'archival_context');
  assert.equal(body.session.bookmarks[0].state, 'resolved');
  assert.equal('resulting_clip_id' in body.session.bookmarks[0], false);
  await assert.rejects(fs.access(clipAudioPath));
  await assert.rejects(fs.access(clipJsonPath));
  await fs.access(
    path.join(libraryRoot, 'trash', 'clips', clip.id, clip.audio_path),
  );
  await fs.access(
    path.join(libraryRoot, 'trash', 'clips', clip.id, `${clip.id}.json`),
  );
  const clipTrashManifestPath = path.join(
    libraryRoot,
    'trash',
    'clips',
    clip.id,
    'manifest.json',
  );
  const clipTrashManifest = await readJson(clipTrashManifestPath);
  assert.equal(clipTrashManifest.clip.id, clip.id);
  assert.equal('restored_bookmark_ids' in clipTrashManifest, false);
  const trashList = await request('/api/trash/clips');
  assert.equal(trashList.response.status, 200);
  assert.equal(
    trashList.body.some(
      (item) => item.id === clip.id && item.source_state === 'active',
    ),
    true,
  );

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM clips WHERE id = ?')
        .get(clip.id).count,
      0,
    );
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM session_clips WHERE clip_id = ?',
        )
        .get(clip.id).count,
      0,
    );
  } finally {
    db.close();
  }

  const restored = await request(`/api/trash/clips/${clip.id}/restore`, {
    method: 'POST',
  });

  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.restored_clip_id, clip.id);
  assert.equal(restored.body.source_state, 'active');
  assert.equal(restored.body.session.clips.includes(clip.id), true);
  assert.equal(restored.body.session.bookmarks[0].state, 'resolved');
  assert.equal(
    'resulting_clip_id' in restored.body.session.bookmarks[0],
    false,
  );
  await fs.access(clipAudioPath);
  await fs.access(clipJsonPath);
  await assert.rejects(
    fs.access(path.join(libraryRoot, 'trash', 'clips', clip.id)),
  );
});

test('restoring a trashed clip works when its source session is unavailable', async () => {
  const created = await request('/api/sessions/session-2026-05-02-005/clips', {
    method: 'POST',
    body: JSON.stringify({
      source_start_seconds: 4,
      source_end_seconds: 11,
      title: 'Standalone memo',
      notes: '',
    }),
  });
  const clip = created.body.clip;

  await request(`/api/clips/${clip.id}`, {
    method: 'DELETE',
  });

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    assert.equal(
      db
        .prepare('PRAGMA foreign_key_list(clips)')
        .all()
        .some((row) => row.table === 'sessions'),
      false,
    );
    db.prepare('DELETE FROM sessions WHERE id = ?').run(clip.source_session_id);
  } finally {
    db.close();
  }

  const trashList = await request('/api/trash/clips');
  assert.equal(
    trashList.body.some(
      (item) => item.id === clip.id && item.source_state === 'unavailable',
    ),
    true,
  );

  const restored = await request(`/api/trash/clips/${clip.id}/restore`, {
    method: 'POST',
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.restored_clip_id, clip.id);
  assert.equal(restored.body.session, null);
  assert.equal(restored.body.source_state, 'unavailable');

  const clips = await request('/api/clips');
  assert.equal(
    clips.body.some(
      (item) =>
        item.id === clip.id &&
        item.source_session_id === 'session-2026-05-02-005',
    ),
    true,
  );
  await fs.access(path.join(libraryRoot, 'clips', clip.audio_path));
  await assert.rejects(
    fs.access(path.join(libraryRoot, 'trash', 'clips', clip.id)),
  );
});

test('expired trashed clips are garbage collected', async () => {
  const created = await request('/api/sessions/session-2026-05-02-003/clips', {
    method: 'POST',
    body: JSON.stringify({
      source_start_seconds: 36,
      source_end_seconds: 42,
      title: 'Purge me',
      notes: '',
    }),
  });
  const clip = created.body.clip;
  await request(`/api/clips/${clip.id}`, {
    method: 'DELETE',
  });

  const clipTrashManifestPath = path.join(
    libraryRoot,
    'trash',
    'clips',
    clip.id,
    'manifest.json',
  );
  const clipTrashManifest = await readJson(clipTrashManifestPath);
  await writeJson(clipTrashManifestPath, {
    ...clipTrashManifest,
    purge_after: '2000-01-01T00:00:00.000Z',
  });
  await request('/api/storage');
  await assert.rejects(
    fs.access(path.join(libraryRoot, 'trash', 'clips', clip.id)),
  );
});

test('invalid clip ranges are rejected without changing source metadata', async () => {
  const before = await readJson(
    path.join(
      libraryRoot,
      'sessions',
      'session-2026-05-02-001',
      'session.json',
    ),
  );
  const { response, body } = await request(
    '/api/sessions/session-2026-05-02-001/clips',
    {
      method: 'POST',
      body: JSON.stringify({
        source_start_seconds: 12,
        source_end_seconds: 8,
        title: 'Bad range',
      }),
    },
  );
  const after = await readJson(
    path.join(
      libraryRoot,
      'sessions',
      'session-2026-05-02-001',
      'session.json',
    ),
  );

  assert.equal(response.status, 400);
  assert.equal(body.error, 'A valid source range is required');
  assert.deepEqual(after, before);
});

test('storage pressure identifies old throwaway sessions as safe reclaim candidates', async () => {
  const { response, body } = await request('/api/storage');

  assert.equal(response.status, 200);
  assert.equal(body.recording_blocked, false);
  assert.equal(body.trash_retention_days, 14);
  assert.ok(body.safe_delete_bytes > 0);
  assert.ok(body.compression_candidate_bytes > 0);

  const candidate = body.candidates.find(
    (item) => item.id === 'session-2026-04-11-002',
  );
  assert.ok(candidate);
  assert.equal(candidate.safe_delete, true);
  assert.equal(candidate.compression_candidate, true);
});

test('delete-safe trashes only safe throwaway sessions and allows restore', async () => {
  const { response, body } = await request('/api/storage/delete-safe', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.deleted_session_ids, ['session-2026-04-11-002']);
  assert.deepEqual(body.trashed_session_ids, ['session-2026-04-11-002']);
  assert.match(body.trashed_sessions[0].purge_after, /^\d{4}-\d{2}-\d{2}T/);

  await assert.rejects(
    fs.access(path.join(libraryRoot, 'sessions', 'session-2026-04-11-002')),
    /ENOENT/,
  );
  await fs.access(
    path.join(
      libraryRoot,
      'trash',
      'sessions',
      'session-2026-04-11-002',
      'session',
      'session.json',
    ),
  );
  await fs.access(
    path.join(
      libraryRoot,
      'trash',
      'sessions',
      'session-2026-04-11-002',
      'waveform.json',
    ),
  );
  const sessionTrashManifest = await readJson(
    path.join(
      libraryRoot,
      'trash',
      'sessions',
      'session-2026-04-11-002',
      'manifest.json',
    ),
  );
  assert.equal(sessionTrashManifest.session.id, 'session-2026-04-11-002');
  const trashList = await request('/api/trash/sessions');
  assert.equal(trashList.response.status, 200);
  assert.deepEqual(
    trashList.body.map((item) => item.id),
    ['session-2026-04-11-002'],
  );
  assert.equal(trashList.body[0].session.duration_seconds, 95);
  await fs.access(
    path.join(
      libraryRoot,
      'sessions',
      'session-2026-05-02-003',
      'session.json',
    ),
  );

  const db = new DatabaseSync(path.join(libraryRoot, 'metadata.sqlite'));
  try {
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?')
        .get('session-2026-04-11-002').count,
      0,
    );
    assert.equal(
      db
        .prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?')
        .get('session-2026-05-02-003').count,
      1,
    );
  } finally {
    db.close();
  }

  const restored = await request(
    '/api/trash/sessions/session-2026-04-11-002/restore',
    {
      method: 'POST',
    },
  );

  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.restored_session_id, 'session-2026-04-11-002');
  await fs.access(
    path.join(
      libraryRoot,
      'sessions',
      'session-2026-04-11-002',
      'session.json',
    ),
  );
  await assert.rejects(
    fs.access(
      path.join(libraryRoot, 'trash', 'sessions', 'session-2026-04-11-002'),
    ),
  );
  const trashAfterRestore = await request('/api/trash/sessions');
  assert.deepEqual(trashAfterRestore.body, []);
});
