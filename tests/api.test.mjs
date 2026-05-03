import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const libraryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "music-memo-machine-test-"));

process.env.NODE_ENV = "test";
process.env.LIBRARY_DIR = libraryRoot;

await execFileAsync(process.execPath, [path.join(projectRoot, "scripts", "seed-fixtures.mjs")], {
  cwd: projectRoot,
  env: {
    ...process.env,
    LIBRARY_DIR: libraryRoot
  }
});

const { app } = await import("../server/index.js");
const server = await listen(app);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await close(server);
  await fs.rm(libraryRoot, { recursive: true, force: true });
});

function listen(appInstance) {
  return new Promise((resolve, reject) => {
    const nextServer = http.createServer(appInstance);
    nextServer.once("error", reject);
    nextServer.listen(0, "127.0.0.1", () => resolve(nextServer));
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
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("health reports the seeded temp library", async () => {
  const { response, body } = await request("/api/health");

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.seeded, true);
  assert.equal(body.library_root, libraryRoot);
});

test("seeded fixture sessions load with bookmarks, waveforms, and existing clips", async () => {
  const { response, body: sessions } = await request("/api/sessions");

  assert.equal(response.status, 200);
  assert.equal(sessions.length, 7);

  const bookmarked = sessions.find((session) => session.id === "session-2026-05-02-003");
  assert.ok(bookmarked);
  assert.equal(bookmarked.bookmarks.length, 1);
  assert.equal(bookmarked.bookmarks[0].state, "unresolved");
  assert.ok(bookmarked.waveform.peaks.length > 100);
  assert.equal(bookmarked.audio_url, "/media/sessions/session-2026-05-02-003/source.wav");

  const clipped = sessions.find((session) => session.id === "session-2026-04-15-007");
  assert.ok(clipped);
  assert.equal(clipped.clip_details.length, 2);
  assert.equal(clipped.clip_details[0].audio_url.startsWith("/media/clips/"), true);
});

test("saving a clip writes copied audio, clip metadata, and archival source state", async () => {
  const { response, body } = await request("/api/sessions/session-2026-05-02-003/clips", {
    method: "POST",
    body: JSON.stringify({
      source_start_seconds: 20,
      source_end_seconds: 30,
      title: "Test clip",
      notes: "Created by integration test"
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.clip.title, "Test clip");
  assert.equal(body.clip.source_session_id, "session-2026-05-02-003");
  assert.equal(body.session.state, "archival_context");
  assert.equal(body.session.retention_class, "archival_context");
  assert.equal(body.session.bookmarks[0].state, "captured");
  assert.equal(body.session.bookmarks[0].resulting_clip_id, body.clip.id);
  assert.equal(body.session.clips.includes(body.clip.id), true);

  const clipAudioPath = path.join(libraryRoot, "clips", body.clip.audio_path);
  const clipJsonPath = path.join(libraryRoot, "clips", `${body.clip.id}.json`);
  const sessionJsonPath = path.join(libraryRoot, "sessions", "session-2026-05-02-003", "session.json");
  const clipAudio = await fs.readFile(clipAudioPath);
  const clipJson = await readJson(clipJsonPath);
  const sessionJson = await readJson(sessionJsonPath);

  assert.equal(clipAudio.toString("ascii", 0, 4), "RIFF");
  assert.equal(clipAudio.toString("ascii", 8, 12), "WAVE");
  assert.equal(clipJson.id, body.clip.id);
  assert.equal(sessionJson.clips.includes(body.clip.id), true);
});

test("invalid clip ranges are rejected without changing source metadata", async () => {
  const before = await readJson(path.join(libraryRoot, "sessions", "session-2026-05-02-001", "session.json"));
  const { response, body } = await request("/api/sessions/session-2026-05-02-001/clips", {
    method: "POST",
    body: JSON.stringify({
      source_start_seconds: 12,
      source_end_seconds: 8,
      title: "Bad range"
    })
  });
  const after = await readJson(path.join(libraryRoot, "sessions", "session-2026-05-02-001", "session.json"));

  assert.equal(response.status, 400);
  assert.equal(body.error, "A valid source range is required");
  assert.deepEqual(after, before);
});

test("storage pressure identifies old throwaway sessions as safe reclaim candidates", async () => {
  const { response, body } = await request("/api/storage");

  assert.equal(response.status, 200);
  assert.equal(body.recording_blocked, false);
  assert.ok(body.safe_delete_bytes > 0);
  assert.ok(body.compression_candidate_bytes > 0);

  const candidate = body.candidates.find((item) => item.id === "session-2026-04-11-002");
  assert.ok(candidate);
  assert.equal(candidate.safe_delete, true);
  assert.equal(candidate.compression_candidate, true);
});

test("delete-safe removes only safe throwaway sessions", async () => {
  const { response, body } = await request("/api/storage/delete-safe", {
    method: "POST"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.deleted_session_ids, ["session-2026-04-11-002"]);

  await assert.rejects(
    fs.access(path.join(libraryRoot, "sessions", "session-2026-04-11-002")),
    /ENOENT/
  );
  await fs.access(path.join(libraryRoot, "sessions", "session-2026-05-02-003", "session.json"));
});
