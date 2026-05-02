import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const libraryRoot = path.resolve(process.env.LIBRARY_DIR || path.join(projectRoot, "library"));
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/media/sessions", express.static(path.join(libraryRoot, "sessions")));
app.use("/media/clips", express.static(path.join(libraryRoot, "clips")));

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function sessionDirs() {
  const root = path.join(libraryRoot, "sessions");
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function loadWaveform(sessionId) {
  const filePath = path.join(libraryRoot, "cache", "waveforms", `${sessionId}.json`);
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function loadClip(clipId) {
  const filePath = path.join(libraryRoot, "clips", `${clipId}.json`);
  if (!(await pathExists(filePath))) {
    return null;
  }
  const clip = await readJson(filePath);
  return {
    ...clip,
    audio_url: `/media/clips/${clip.audio_path}`
  };
}

async function loadSession(sessionId) {
  const sessionPath = path.join(libraryRoot, "sessions", sessionId, "session.json");
  const session = await readJson(sessionPath);
  const sourcePath = path.join(libraryRoot, "sessions", sessionId, session.audio_path);
  const stat = await fs.stat(sourcePath);
  const clipDetails = [];

  for (const clipId of session.clips || []) {
    const clip = await loadClip(clipId);
    if (clip) {
      clipDetails.push(clip);
    }
  }

  return {
    ...session,
    audio_url: `/media/sessions/${sessionId}/${session.audio_path}`,
    source_size_bytes: session.storage_size_bytes || stat.size,
    actual_source_size_bytes: stat.size,
    waveform: await loadWaveform(sessionId),
    clip_details: clipDetails
  };
}

async function loadSessions() {
  const ids = await sessionDirs();
  const sessions = await Promise.all(ids.map((id) => loadSession(id)));
  return sessions.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

async function loadClips() {
  const clipsRoot = path.join(libraryRoot, "clips");
  if (!(await pathExists(clipsRoot))) {
    return [];
  }
  const entries = await fs.readdir(clipsRoot);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  const clips = await Promise.all(jsonFiles.map((entry) => readJson(path.join(clipsRoot, entry))));
  return clips.map((clip) => ({
    ...clip,
    audio_url: `/media/clips/${clip.audio_path}`
  }));
}

async function saveSession(session) {
  await writeJson(path.join(libraryRoot, "sessions", session.id, "session.json"), stripRuntimeSessionFields(session));
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

async function saveClip(clip) {
  await writeJson(path.join(libraryRoot, "clips", `${clip.id}.json`), stripRuntimeClipFields(clip));
}

async function loadStorageSim() {
  const simPath = path.join(libraryRoot, "storage-sim.json");
  if (!(await pathExists(simPath))) {
    const defaultSim = {
      as_of: new Date().toISOString(),
      total_bytes: 8 * 1024 * 1024 * 1024,
      simulated_free_bytes: 3 * 1024 * 1024 * 1024,
      policy: {
        min_free_gb: 2,
        min_free_percent: 0.15,
        unbookmarked_retention_days: 14,
        unbookmarked_compression_days: 3,
        archival_compression_days: 30,
        lossy_only_throwaway: true
      }
    };
    await writeJson(simPath, defaultSim);
    return defaultSim;
  }
  return readJson(simPath);
}

async function saveStorageSim(sim) {
  await writeJson(path.join(libraryRoot, "storage-sim.json"), sim);
}

function ageDays(createdAt, asOf) {
  return Math.max(0, (Date.parse(asOf) - Date.parse(createdAt)) / 86_400_000);
}

function hasDurableBookmark(session) {
  return (session.bookmarks || []).some((bookmark) => bookmark.state !== "dismissed");
}

function classifySession(session, sim) {
  const policy = sim.policy;
  const age = ageDays(session.created_at, sim.as_of);
  const hasBookmarks = hasDurableBookmark(session);
  const hasClips = (session.clips || []).length > 0;
  const hasNotes = Boolean((session.notes || "").trim());
  const size = session.source_size_bytes || session.storage_size_bytes || 0;
  const isThrowaway = session.retention_class === "throwaway";
  const safeDelete =
    session.state === "dismissed" ||
    (isThrowaway &&
      !hasBookmarks &&
      !hasClips &&
      !hasNotes &&
      age >= policy.unbookmarked_retention_days);
  const compressionCandidate =
    session.compression_state === "raw_wav" &&
    ((isThrowaway && age >= policy.unbookmarked_compression_days) ||
      (session.retention_class === "archival_context" && age >= policy.archival_compression_days));
  const lossyCandidate = policy.lossy_only_throwaway && isThrowaway && !hasBookmarks && !hasClips && age >= policy.unbookmarked_retention_days;
  const protectedReason =
    session.retention_class === "protected"
      ? "protected"
      : session.retention_class === "archival_context"
        ? "archival context"
        : hasBookmarks
          ? "bookmarks"
          : hasClips
            ? "saved clips"
            : "";

  return {
    id: session.id,
    age_days: Number(age.toFixed(1)),
    size_bytes: size,
    safe_delete: safeDelete,
    compression_candidate: compressionCandidate,
    lossy_candidate: lossyCandidate,
    protected_reason: protectedReason,
    estimated_compression_savings_bytes: compressionCandidate ? Math.floor(size * 0.42) : 0
  };
}

function summarizeStorage(sessions, clips, sim) {
  const minFreeBytes = Math.max(
    sim.policy.min_free_gb * 1024 * 1024 * 1024,
    Math.floor(sim.total_bytes * sim.policy.min_free_percent)
  );
  const classifications = sessions.map((session) => classifySession(session, sim));
  const byId = new Map(classifications.map((item) => [item.id, item]));
  const sourceBytes = sessions
    .filter((session) => session.retention_class !== "archival_context")
    .reduce((sum, session) => sum + (session.source_size_bytes || 0), 0);
  const archivalBytes = sessions
    .filter((session) => session.retention_class === "archival_context")
    .reduce((sum, session) => sum + (session.source_size_bytes || 0), 0);
  const clipBytes = clips.reduce((sum, clip) => sum + (clip.storage_size_bytes || 0), 0);
  const cacheBytes = Math.max(2 * 1024 * 1024, Math.floor((sourceBytes + archivalBytes) * 0.006));
  const safeDeleteBytes = classifications
    .filter((item) => item.safe_delete)
    .reduce((sum, item) => sum + item.size_bytes, 0);
  const compressionBytes = classifications.reduce((sum, item) => sum + item.estimated_compression_savings_bytes, 0);
  const unsyncedClips = clips.filter((clip) => clip.sync_state !== "synced").length;
  const unsyncedSessions = sessions.filter(
    (session) =>
      session.sync_state !== "synced" &&
      (session.retention_class === "archival_context" || session.retention_class === "protected" || hasDurableBookmark(session))
  ).length;
  const deficitBytes = Math.max(0, minFreeBytes - sim.simulated_free_bytes);
  const recordingBlocked = deficitBytes > 0 && safeDeleteBytes + compressionBytes < deficitBytes;

  return {
    total_bytes: sim.total_bytes,
    free_bytes: sim.simulated_free_bytes,
    minimum_free_bytes: minFreeBytes,
    estimated_recording_minutes: Math.floor(sim.simulated_free_bytes / (10 * 1024 * 1024)),
    source_session_bytes: sourceBytes,
    archival_context_bytes: archivalBytes,
    saved_clip_bytes: clipBytes,
    cache_bytes: cacheBytes,
    safe_delete_bytes: safeDeleteBytes,
    compression_candidate_bytes: compressionBytes,
    unsynced_durable_count: unsyncedClips + unsyncedSessions,
    recording_blocked: recordingBlocked,
    deficit_bytes: deficitBytes,
    candidates: classifications,
    sessions: sessions.map((session) => ({
      id: session.id,
      state: session.state,
      retention_class: session.retention_class,
      compression_state: session.compression_state,
      sync_state: session.sync_state,
      source_size_bytes: session.source_size_bytes,
      ...byId.get(session.id)
    }))
  };
}

function createClipId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const random = Math.random().toString(16).slice(2, 7);
  return `clip-${stamp}-${random}`;
}

function findWavChunk(buffer, chunkId) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === chunkId) {
      return { offset: offset + 8, size, sizeOffset: offset + 4 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function trimWavFile(sourcePath, targetPath, startSeconds, endSeconds) {
  const source = await fs.readFile(sourcePath);
  if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only WAV fixtures can be trimmed in this prototype");
  }

  const fmt = findWavChunk(source, "fmt ");
  const data = findWavChunk(source, "data");
  if (!fmt || !data) {
    throw new Error("WAV file is missing fmt or data chunks");
  }

  const byteRate = source.readUInt32LE(fmt.offset + 8);
  const blockAlign = source.readUInt16LE(fmt.offset + 12);
  const duration = data.size / byteRate;
  const safeStart = Math.max(0, Math.min(startSeconds, duration));
  const safeEnd = Math.max(safeStart + 0.1, Math.min(endSeconds, duration));
  const startByte = data.offset + Math.floor((safeStart * byteRate) / blockAlign) * blockAlign;
  const endByte = data.offset + Math.floor((safeEnd * byteRate) / blockAlign) * blockAlign;
  const clipData = source.subarray(startByte, endByte);
  const header = Buffer.from(source.subarray(0, data.offset));

  header.writeUInt32LE(header.length + clipData.length - 8, 4);
  header.writeUInt32LE(clipData.length, data.sizeOffset);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.concat([header, clipData]));
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    library_root: libraryRoot,
    seeded: await pathExists(path.join(libraryRoot, "sessions"))
  });
});

app.get("/api/sessions", async (_req, res, next) => {
  try {
    res.json(await loadSessions());
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions/:id", async (req, res, next) => {
  try {
    res.json(await loadSession(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/sessions/:id", async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    const allowed = [
      "state",
      "retention_class",
      "compression_state",
      "sync_state",
      "notes",
      "bookmarks"
    ];

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        session[key] = req.body[key];
      }
    }

    await saveSession(session);
    res.json(await loadSession(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions/:id/clips", async (req, res, next) => {
  try {
    const session = await loadSession(req.params.id);
    const start = Number(req.body.source_start_seconds);
    const end = Number(req.body.source_end_seconds);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      res.status(400).json({ error: "A valid source range is required" });
      return;
    }

    const clipId = createClipId();
    const audioPath = `${clipId}.wav`;
    const sourcePath = path.join(libraryRoot, "sessions", session.id, session.audio_path);
    const targetPath = path.join(libraryRoot, "clips", audioPath);

    await trimWavFile(sourcePath, targetPath, start, end);

    const stat = await fs.stat(targetPath);
    const capturedIds = new Set(req.body.bookmark_ids || []);
    const clip = {
      id: clipId,
      source_session_id: session.id,
      source_start_seconds: start,
      source_end_seconds: end,
      audio_path: audioPath,
      created_at: new Date().toISOString(),
      title: req.body.title || "",
      notes: req.body.notes || "",
      sync_state: "local_only",
      storage_size_bytes: Math.max(stat.size, Math.round((end - start) * 10 * 1024 * 1024))
    };

    session.bookmarks = (session.bookmarks || []).map((bookmark) => {
      const inRange = bookmark.timestamp_seconds >= start && bookmark.timestamp_seconds <= end;
      if (inRange || capturedIds.has(bookmark.id)) {
        return {
          ...bookmark,
          state: "captured",
          resulting_clip_id: clipId
        };
      }
      return bookmark;
    });
    session.clips = Array.from(new Set([...(session.clips || []), clipId]));
    session.state = "archival_context";
    session.retention_class = "archival_context";
    session.sync_state = session.sync_state === "synced" ? "pending_sync" : session.sync_state;

    await saveClip(clip);
    await saveSession(session);
    res.status(201).json({
      session: await loadSession(session.id),
      clip: await loadClip(clipId)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/clips/:id", async (req, res, next) => {
  try {
    const clip = await loadClip(req.params.id);
    if (!clip) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    const allowed = ["title", "notes", "sync_state"];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        clip[key] = req.body[key];
      }
    }
    await saveClip(clip);
    res.json(await loadClip(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/storage", async (_req, res, next) => {
  try {
    const [sessions, clips, sim] = await Promise.all([loadSessions(), loadClips(), loadStorageSim()]);
    res.json(summarizeStorage(sessions, clips, sim));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/storage", async (req, res, next) => {
  try {
    const sim = await loadStorageSim();
    if (Number.isFinite(Number(req.body.free_bytes))) {
      sim.simulated_free_bytes = Math.max(0, Math.min(sim.total_bytes, Number(req.body.free_bytes)));
    }
    if (Number.isFinite(Number(req.body.total_bytes))) {
      sim.total_bytes = Math.max(1, Number(req.body.total_bytes));
    }
    await saveStorageSim(sim);
    const [sessions, clips] = await Promise.all([loadSessions(), loadClips()]);
    res.json(summarizeStorage(sessions, clips, sim));
  } catch (error) {
    next(error);
  }
});

app.post("/api/storage/delete-safe", async (_req, res, next) => {
  try {
    const [sessions, clips, sim] = await Promise.all([loadSessions(), loadClips(), loadStorageSim()]);
    const summary = summarizeStorage(sessions, clips, sim);
    const safeIds = summary.candidates.filter((candidate) => candidate.safe_delete).map((candidate) => candidate.id);

    for (const id of safeIds) {
      await fs.rm(path.join(libraryRoot, "sessions", id), { recursive: true, force: true });
      await fs.rm(path.join(libraryRoot, "cache", "waveforms", `${id}.json`), { force: true });
    }

    res.json({
      deleted_session_ids: safeIds,
      storage: summarizeStorage(await loadSessions(), await loadClips(), sim)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/storage/compress-candidates", async (_req, res, next) => {
  try {
    const [sessions, clips, sim] = await Promise.all([loadSessions(), loadClips(), loadStorageSim()]);
    const summary = summarizeStorage(sessions, clips, sim);
    const candidateIds = new Set(summary.candidates.filter((candidate) => candidate.compression_candidate).map((candidate) => candidate.id));

    for (const session of sessions) {
      if (candidateIds.has(session.id)) {
        session.compression_state = "flac";
        await saveSession(session);
      }
    }

    res.json({
      compressed_session_ids: Array.from(candidateIds),
      storage: summarizeStorage(await loadSessions(), await loadClips(), sim)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/storage/lossy-throwaways", async (_req, res, next) => {
  try {
    const [sessions, clips, sim] = await Promise.all([loadSessions(), loadClips(), loadStorageSim()]);
    const summary = summarizeStorage(sessions, clips, sim);
    const candidateIds = new Set(summary.candidates.filter((candidate) => candidate.lossy_candidate).map((candidate) => candidate.id));

    for (const session of sessions) {
      if (candidateIds.has(session.id)) {
        session.compression_state = "lossy";
        await saveSession(session);
      }
    }

    res.json({
      degraded_session_ids: Array.from(candidateIds),
      storage: summarizeStorage(await loadSessions(), await loadClips(), sim)
    });
  } catch (error) {
    next(error);
  }
});

const distPath = path.join(projectRoot, "dist");
if (process.env.NODE_ENV === "production" && (await pathExists(distPath))) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

app.listen(port, host, () => {
  console.log(`Music Memo Machine API listening on http://${host}:${port}`);
  console.log(`Library: ${libraryRoot}`);
});
