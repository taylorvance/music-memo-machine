# Recorder Ingestion Contract

The first ingestion path is intentionally small and dependency-free so the recorder emulator and future Pi recorder can target the same manager behavior.

## Session Import

Submit one complete recorder session:

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

Fields:

- `id` is required. `session_id` and `recorder_session_id` are accepted aliases. It must be a safe path segment containing only letters, numbers, dot, underscore, or dash.
- `created_at` is required and must be parseable as a date.
- `audio.data_base64` is required and must decode to a WAV file. `audio_base64` is accepted as a temporary alias.
- `bookmarks` is optional. Bookmark IDs are optional and default to `bookmark-001`, `bookmark-002`, and so on. Bookmark timestamps must be within the decoded WAV duration.
- `device_name`, `title`, `notes`, bookmark `created_at`, and bookmark `note` are optional.

The server derives `duration_seconds`, `sample_rate`, `channel_count`, and `storage_size_bytes` from the WAV. It writes:

- `library/sessions/<id>/source.wav`
- `library/sessions/<id>/session.json`
- normalized SQLite rows for the session and bookmarks

Sessions with non-dismissed bookmarks start as `bookmarked` / `review_pending`; sessions without durable bookmarks start as `unreviewed` / `throwaway`. Imported sessions are marked `sync_state: "synced"` because the manager has accepted the recorder copy.

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

An exact retry with the same session ID and same WAV bytes returns `200` with `duplicate: true` and does not overwrite manager-side metadata edits.

If the session ID already exists with different audio bytes, the server returns `409`. The recorder must keep its local copy and surface or retry the conflict intentionally; it should not delete local audio on a conflict.

## Current Limits

This endpoint uses JSON and base64 audio. The default request limit is `32mb` and can be changed with `JSON_BODY_LIMIT`. This is good enough for the emulator and short recorder sessions, but multipart upload or spool-directory import is still open for longer recordings.
