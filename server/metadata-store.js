import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  audio_path TEXT NOT NULL,
  state TEXT NOT NULL,
  retention_class TEXT NOT NULL,
  compression_state TEXT NOT NULL,
  sync_state TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  device_name TEXT,
  sample_rate INTEGER,
  channel_count INTEGER,
  storage_size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  timestamp_seconds REAL NOT NULL,
  created_at TEXT,
  state TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  resulting_clip_id TEXT,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  source_start_seconds REAL NOT NULL,
  source_end_seconds REAL NOT NULL,
  audio_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sync_state TEXT NOT NULL,
  storage_size_bytes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_clips (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, clip_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_session_time ON bookmarks(session_id, timestamp_seconds);
CREATE INDEX IF NOT EXISTS idx_clips_source_session ON clips(source_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
`;

export function createMetadataStore(libraryRoot) {
  fsSync.mkdirSync(libraryRoot, { recursive: true });

  const dbPath = path.join(libraryRoot, "metadata.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(schema);
  migrateSchema();

  function close() {
    db.close();
  }

  function hasSessions() {
    return db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count > 0;
  }

  async function importSidecarLibrary({ replace = false } = {}) {
    if (!replace && hasSessions()) {
      return { imported_sessions: 0, imported_clips: 0 };
    }

    const sessions = await readSessionSidecars(libraryRoot);
    const clips = await readClipSidecars(libraryRoot);

    transaction(() => {
      if (replace) {
        db.prepare("DELETE FROM session_clips").run();
        db.prepare("DELETE FROM bookmarks").run();
        db.prepare("DELETE FROM clips").run();
        db.prepare("DELETE FROM sessions").run();
      }

      for (const session of sessions) {
        upsertSessionRow(session);
        replaceBookmarkRows(session.id, session.bookmarks || []);
      }

      for (const clip of clips) {
        upsertClipRow(clip);
      }

      const clipIds = new Set(clips.map((clip) => clip.id));
      for (const session of sessions) {
        replaceSessionClipRows(
          session.id,
          (session.clips || []).filter((clipId) => clipIds.has(clipId))
        );
      }
    });

    return {
      imported_sessions: sessions.length,
      imported_clips: clips.length
    };
  }

  function loadSessionsMetadata() {
    return db
      .prepare("SELECT * FROM sessions ORDER BY datetime(created_at) DESC, id DESC")
      .all()
      .map((row) => hydrateSession(row));
  }

  function loadSessionMetadata(sessionId) {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    return row ? hydrateSession(row) : null;
  }

  function loadClipsMetadata() {
    return db
      .prepare("SELECT * FROM clips ORDER BY datetime(created_at) DESC, id DESC")
      .all()
      .map((row) => clipFromRow(row));
  }

  function loadClipMetadata(clipId) {
    const row = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId);
    return row ? clipFromRow(row) : null;
  }

  async function saveSessionMetadata(session) {
    transaction(() => {
      upsertSessionRow(session);
      replaceBookmarkRows(session.id, session.bookmarks || []);
      replaceSessionClipRows(session.id, session.clips || []);
    });
    await writeSessionSidecar(libraryRoot, session);
  }

  async function saveClipMetadata(clip) {
    transaction(() => {
      upsertClipRow(clip);
      if (clip.source_session_id && sessionExists(clip.source_session_id)) {
        db.prepare(
          "INSERT OR IGNORE INTO session_clips (session_id, clip_id) VALUES (?, ?)"
        ).run(clip.source_session_id, clip.id);
      }
    });
    await writeClipSidecar(libraryRoot, clip);
  }

  function deleteClipMetadata(clipId) {
    db.prepare("DELETE FROM clips WHERE id = ?").run(clipId);
  }

  function deleteSessionMetadata(sessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function sessionExists(sessionId) {
    return db.prepare("SELECT 1 AS found FROM sessions WHERE id = ?").get(sessionId) !== undefined;
  }

  function migrateSchema() {
    const clipForeignKeys = db.prepare("PRAGMA foreign_key_list(clips)").all();
    if (clipForeignKeys.some((row) => row.table === "sessions")) {
      db.exec("PRAGMA foreign_keys = OFF");
      try {
        db.exec(`
          CREATE TABLE clips_next (
            id TEXT PRIMARY KEY,
            source_session_id TEXT NOT NULL,
            source_start_seconds REAL NOT NULL,
            source_end_seconds REAL NOT NULL,
            audio_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            sync_state TEXT NOT NULL,
            storage_size_bytes INTEGER NOT NULL DEFAULT 0
          );

          INSERT INTO clips_next (
            id,
            source_session_id,
            source_start_seconds,
            source_end_seconds,
            audio_path,
            created_at,
            title,
            notes,
            sync_state,
            storage_size_bytes
          )
          SELECT
            id,
            source_session_id,
            source_start_seconds,
            source_end_seconds,
            audio_path,
            created_at,
            title,
            notes,
            sync_state,
            storage_size_bytes
          FROM clips;

          DROP TABLE clips;
          ALTER TABLE clips_next RENAME TO clips;
        `);
      } finally {
        db.exec("PRAGMA foreign_keys = ON");
      }
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_clips_source_session ON clips(source_session_id)");
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = ?").run("2", "schema_version");
  }

  function hydrateSession(row) {
    const session = sessionFromRow(row);
    session.bookmarks = db
      .prepare("SELECT * FROM bookmarks WHERE session_id = ? ORDER BY timestamp_seconds ASC, id ASC")
      .all(session.id)
      .map((bookmark) => bookmarkFromRow(bookmark));
    session.clips = db
      .prepare("SELECT clip_id FROM session_clips WHERE session_id = ? ORDER BY clip_id ASC")
      .all(session.id)
      .map((item) => item.clip_id);
    return session;
  }

  function upsertSessionRow(session) {
    db.prepare(
      `INSERT INTO sessions (
        id,
        created_at,
        duration_seconds,
        audio_path,
        state,
        retention_class,
        compression_state,
        sync_state,
        notes,
        device_name,
        sample_rate,
        channel_count,
        storage_size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        duration_seconds = excluded.duration_seconds,
        audio_path = excluded.audio_path,
        state = excluded.state,
        retention_class = excluded.retention_class,
        compression_state = excluded.compression_state,
        sync_state = excluded.sync_state,
        notes = excluded.notes,
        device_name = excluded.device_name,
        sample_rate = excluded.sample_rate,
        channel_count = excluded.channel_count,
        storage_size_bytes = excluded.storage_size_bytes`
    ).run(
      session.id,
      session.created_at,
      session.duration_seconds,
      session.audio_path,
      session.state,
      session.retention_class,
      session.compression_state,
      session.sync_state,
      session.notes || "",
      session.device_name ?? null,
      session.sample_rate ?? null,
      session.channel_count ?? null,
      session.storage_size_bytes ?? null
    );
  }

  function replaceBookmarkRows(sessionId, bookmarks) {
    db.prepare("DELETE FROM bookmarks WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(
      `INSERT INTO bookmarks (
        id,
        session_id,
        timestamp_seconds,
        created_at,
        state,
        note,
        resulting_clip_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const bookmark of bookmarks) {
      insert.run(
        bookmark.id,
        sessionId,
        bookmark.timestamp_seconds,
        bookmark.created_at ?? null,
        bookmark.state,
        bookmark.note || "",
        bookmark.resulting_clip_id ?? null
      );
    }
  }

  function replaceSessionClipRows(sessionId, clipIds) {
    db.prepare("DELETE FROM session_clips WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO session_clips (session_id, clip_id) VALUES (?, ?)"
    );

    for (const clipId of clipIds) {
      insert.run(sessionId, clipId);
    }
  }

  function upsertClipRow(clip) {
    db.prepare(
      `INSERT INTO clips (
        id,
        source_session_id,
        source_start_seconds,
        source_end_seconds,
        audio_path,
        created_at,
        title,
        notes,
        sync_state,
        storage_size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_session_id = excluded.source_session_id,
        source_start_seconds = excluded.source_start_seconds,
        source_end_seconds = excluded.source_end_seconds,
        audio_path = excluded.audio_path,
        created_at = excluded.created_at,
        title = excluded.title,
        notes = excluded.notes,
        sync_state = excluded.sync_state,
        storage_size_bytes = excluded.storage_size_bytes`
    ).run(
      clip.id,
      clip.source_session_id,
      clip.source_start_seconds,
      clip.source_end_seconds,
      clip.audio_path,
      clip.created_at,
      clip.title || "",
      clip.notes || "",
      clip.sync_state,
      clip.storage_size_bytes || 0
    );
  }

  return {
    dbPath,
    close,
    hasSessions,
    importSidecarLibrary,
    loadSessionsMetadata,
    loadSessionMetadata,
    loadClipsMetadata,
    loadClipMetadata,
    saveSessionMetadata,
    saveClipMetadata,
    deleteClipMetadata,
    deleteSessionMetadata
  };
}

function sessionFromRow(row) {
  return removeUndefined({
    id: row.id,
    created_at: row.created_at,
    duration_seconds: row.duration_seconds,
    audio_path: row.audio_path,
    state: row.state,
    retention_class: row.retention_class,
    compression_state: row.compression_state,
    sync_state: row.sync_state,
    notes: row.notes || "",
    device_name: row.device_name ?? undefined,
    sample_rate: row.sample_rate ?? undefined,
    channel_count: row.channel_count ?? undefined,
    storage_size_bytes: row.storage_size_bytes ?? undefined,
    bookmarks: [],
    clips: []
  });
}

function bookmarkFromRow(row) {
  return removeUndefined({
    id: row.id,
    timestamp_seconds: row.timestamp_seconds,
    created_at: row.created_at ?? undefined,
    state: row.state,
    note: row.note || "",
    resulting_clip_id: row.resulting_clip_id ?? undefined
  });
}

function clipFromRow(row) {
  return {
    id: row.id,
    source_session_id: row.source_session_id,
    source_start_seconds: row.source_start_seconds,
    source_end_seconds: row.source_end_seconds,
    audio_path: row.audio_path,
    created_at: row.created_at,
    title: row.title || "",
    notes: row.notes || "",
    sync_state: row.sync_state,
    storage_size_bytes: row.storage_size_bytes || 0
  };
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function readSessionSidecars(libraryRoot) {
  const root = path.join(libraryRoot, "sessions");
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(root, entry.name, "session.json");
    if (await pathExists(jsonPath)) {
      sessions.push(await readJson(jsonPath));
    }
  }

  return sessions.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

async function readClipSidecars(libraryRoot) {
  const clipsRoot = path.join(libraryRoot, "clips");
  if (!(await pathExists(clipsRoot))) {
    return [];
  }

  const entries = await fs.readdir(clipsRoot);
  const clips = [];

  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    clips.push(await readJson(path.join(clipsRoot, entry)));
  }

  return clips;
}

async function writeSessionSidecar(libraryRoot, session) {
  await writeJson(path.join(libraryRoot, "sessions", session.id, "session.json"), stripRuntimeSessionFields(session));
}

async function writeClipSidecar(libraryRoot, clip) {
  await writeJson(path.join(libraryRoot, "clips", `${clip.id}.json`), stripRuntimeClipFields(clip));
}

function stripRuntimeSessionFields(session) {
  const {
    audio_url,
    source_size_bytes,
    actual_source_size_bytes,
    waveform,
    clip_details,
    ...persisted
  } = session;
  return persisted;
}

function stripRuntimeClipFields(clip) {
  const { audio_url, ...persisted } = clip;
  return persisted;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
