# Recorder Ingestion Contract

The manager owns recorder session import, audio validation, metadata
normalization, and waveform cache generation. Recorders submit complete WAV
sessions plus bookmark metadata; they do not submit authoritative waveform data.

The browser recorder emulator and CLI harness that target this endpoint are
documented in `docs/emulator.md`.

## Preferred Session Import

Submit one complete recorder session as multipart form data:

```http
POST /api/ingest/sessions
Content-Type: multipart/form-data
```

Parts:

- `metadata`: JSON string for the session metadata.
- `audio`: WAV file data. The field name must be `audio`; the filename is not
  authoritative.

`metadata` shape:

```json
{
  "id": "recorder-1-20260505-120000",
  "device_name": "music-memo-recorder-1",
  "created_at": "2026-05-05T12:00:00.000Z",
  "title": "",
  "notes": "",
  "bookmarks": [
    {
      "id": "bookmark-001",
      "timestamp_seconds": 12.4,
      "created_at": "2026-05-05T12:00:12.400Z",
      "note": ""
    }
  ]
}
```

Fields:

- `id` is required. `session_id` and `recorder_session_id` are accepted aliases.
  It must be a safe path segment containing only letters, numbers, dot,
  underscore, or dash.
- `created_at` is required and must be parseable as a date.
- `audio` must be a WAV file. The manager currently accepts PCM integer WAVs and
  32-bit float WAVs.
- `bookmarks` is optional. Bookmark IDs are optional and default to
  `bookmark-001`, `bookmark-002`, and so on. Bookmark timestamps must be within
  the decoded WAV duration.
- `device_name`, `title`, `notes`, bookmark `created_at`, and bookmark `note`
  are optional.

The server derives `duration_seconds`, `sample_rate`, `channel_count`, and
`storage_size_bytes` from the WAV. It also scans the saved WAV to write a real
waveform cache. It writes:

- `library/sessions/<id>/source.wav`
- `library/sessions/<id>/session.json`
- `library/cache/waveforms/<id>.json`
- normalized SQLite rows for the session and bookmarks

Sessions with non-dismissed bookmarks start as `bookmarked` /
`review_pending`; sessions without durable bookmarks start as `unreviewed` /
`throwaway`. Imported sessions are marked `sync_state: "synced"` because the
manager has accepted the recorder copy.

## Compatibility JSON Import

Small tools and saved test payloads can still submit JSON with base64 audio:

```http
POST /api/ingest/sessions
Content-Type: application/json
```

Request body:

```json
{
  "id": "recorder-1-20260505-120000",
  "device_name": "music-memo-recorder-1",
  "created_at": "2026-05-05T12:00:00.000Z",
  "title": "",
  "notes": "",
  "audio": {
    "data_base64": "..."
  },
  "bookmarks": [
    {
      "id": "bookmark-001",
      "timestamp_seconds": 12.4,
      "created_at": "2026-05-05T12:00:12.400Z",
      "note": ""
    }
  ]
}
```

This path has the same metadata behavior and acknowledgement semantics, but it
is not the preferred route for normal multi-minute recordings.

## Acknowledgements And Retries

Successful import returns `201`:

```json
{
  "acknowledged": true,
  "duplicate": false,
  "imported": true,
  "session_id": "recorder-1-20260505-120000",
  "session": {}
}
```

An exact retry with the same session ID and same WAV bytes returns `200` with
`duplicate: true` and does not overwrite manager-side metadata edits.

If the session ID already exists with different audio bytes, the server returns
`409`. The recorder must keep its local copy and surface or retry the conflict
intentionally; it should not delete local audio on a conflict.

## Current Limits

Multipart audio upload streams the WAV to a temporary file before validation and
defaults to a `512mb` file limit. Set `AUDIO_UPLOAD_LIMIT_BYTES` to change that
limit.

The compatibility JSON path still uses base64 audio and Express JSON parsing.
Its default request limit is `32mb` and can be changed with `JSON_BODY_LIMIT`.
Use it for small fixtures and replay payloads, not normal long recorder sync.
