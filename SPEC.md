# Rpi music memo machine

## Snapshot

Build a dedicated, low-friction music idea recorder for casual playing spaces.
It should work for piano, guitar, voice, electronic instruments, MIDI gear, or
anything else that can be captured by a microphone from the room or a speaker.

The device should be always available. In v1, it is not always recording; it
sits near the instrument, waits quietly, and starts a recording when the player
presses the record button. During the recording, the player can press a
bookmark button to mark moments worth reviewing later. The review workflow then
turns bookmarked regions into saved music memos and lets the rest age out.

The core problem is psychological and ergonomic, not just technical:

- inspiration often arrives before the player knows it is worth recording
- starting a formal recording can make the take feel high stakes
- reviewing long unstructured recordings is tedious
- good sections get lost if there is no fast way to mark them while playing

The v1 product should make capture almost thoughtless and make cleanup fast
enough that the device can stay in regular use.

## Goals

- Record music ideas with a built-in or attached microphone
- Start and stop recording with one physical button
- Add timestamp bookmarks during recording with one physical button
- Show recording state with an obvious red status LED
- Auto-stop after a configurable long silence period
- Store recordings locally on the device
- Provide a phone/computer review UI with waveform, bookmarks, scrubbing, trim,
  save, and trash actions
- Turn useful sections into separate saved clips or memos
- Keep recorder storage safe: preserve unsynced recordings, delete only
  transferred local copies under pressure, and block clearly when no safe space
  can be reclaimed
- Run review and management off the recorder by default, likely on a Mac mini on
  Tailscale, while leaving room for an all-in-one recorder/reviewer later

## Non-goals

- Studio-quality recording in v1
- Laptop-dependent capture
- DAW integration as the primary workflow
- Always-recording surveillance or continuous archival audio
- Complex capture-time categorization
- Polished cloud sync on the first prototype
- Editing features beyond trimming saved clips from recordings

## Intended Use

### Normal capture

1. Device is powered and idle near the instrument.
2. Player sits down and presses record.
3. Red LED turns on.
4. Device records microphone audio to a local session file.
5. Player presses bookmark whenever a passage seems worth revisiting.
6. Device stores the bookmark timestamp in session metadata.
7. Player presses record again to stop, or silence auto-stop ends the session.
8. Session appears in the review UI.

### Review

1. Player opens a local web UI from phone or computer.
2. UI lists unresolved sessions, emphasizing sessions with bookmarks.
3. Player opens a session and sees a waveform with bookmark markers.
4. Clicking a bookmark (or next/prev buttons) jumps playback to that timestamp.
5. Player scrubs, selects a range, and saves that range as a music memo clip.
6. Once all useful parts are extracted, the session can be marked resolved.
7. The management library keeps source sessions by default as durable context.
   The recorder's local copy may become eligible for deletion only after the
   management host durably acknowledges transfer.

## V1 Hardware Posture

The preferred v1 is a standalone appliance, not a laptop workflow. A phone app
may be a viable alternative if it can stay as frictionless as a dedicated box
and if storage lifecycle management prevents the phone from filling with junk
takes.

Recommended starting point:

- small Raspberry Pi or similar single-board computer
- built-in or permanently attached "good enough" microphone
- optional support for a higher-quality USB microphone
- record/stop toggle button
- bookmark button
- red recording LED
- wall power
- local storage large enough for many raw sessions

Nice-to-have hardware:

- battery option if it is easy, but wall power is acceptable
- 8-digit 7-segment display for terse status if it proves useful
- portable enclosure that can move from piano to guitar room or to a friend's
  house

The device should be easy to move, but it should still feel dedicated: always
used for this one purpose, always ready, and not dependent on opening a general
computer.

## Audio Input

Primary use cases:

- piano, guitar, and other instruments in casual playing rooms
- room or speaker microphone capture
- idea-quality audio, not studio master audio

Microphone design remains open:

- built-in mic is ideal for daily use because it removes setup friction
- external USB mic support is valuable for rarer official sessions
- the first prototype may use an existing decent USB mic to validate the
  workflow before choosing an embedded mic

The spec should not optimize early around perfect sound. It should optimize
around capturing musical ideas reliably enough that they can be developed into
finished recordings later.

## Recording Model

V1 should start with explicit recording only:

- no rolling pre-buffer
- no always-recording audio retention
- record starts at button press
- record stops at button press or silence auto-stop

A rolling buffer is a promising later feature, but it is not required for the
first useful version. It increases power use and complexity because the audio
pipeline must run continuously, even if old audio is kept only in memory.

Possible later model:

- keep a short rolling audio window in memory or temporary storage
- allow the bookmark button to start a session retroactively
- choose the retroactive start point by fixed pre-roll, recent silence boundary,
  or a combination of both
- continue recording normally after the retroactive start

This could solve the "I realized too late that I should be recording" problem
more directly than explicit recording, but it should be evaluated after the
basic capture/review loop is proven.

### Silence auto-stop

Default:

- stop after 5 minutes of silence
- make the timeout configurable

Open design questions:

- what threshold counts as silence for piano/guitar rooms
- whether the threshold should be calibrated manually
- whether the LED should flash when auto-stop is imminent
- whether a bookmark should reset or affect auto-stop behavior

The auto-stop feature should prevent accidental multi-hour recordings without
making the player think about recording management while playing.

## Physical Controls

V1 controls:

- record/stop toggle
- bookmark
- recording status LED

The hardware should keep capture-time controls minimal. Review, rating,
trimming, deletion, and organization belong in the web UI unless real use shows
that a capture-time action is needed.

Possible later controls:

- undo last bookmark
- keep/take rating
- shutdown or sync via long-press
- low-storage or sync status indicator

The undo/delete-bookmark button is intentionally not in v1. It could be useful,
but it also adds a new way to make mistakes during a take.

## Bookmark Semantics

A bookmark marks "now."

It does not attempt to infer the start or end of the good section. The player
will use the bookmark as a review jump point and scrub around it later.

Metadata per bookmark should include:

- timestamp within the session
- wall-clock created time if available
- optional label or note later, from the review UI
- resolution state once the bookmark has been reviewed

Resolved is a review state, not a hard link to a clip. If a player clicks the
bookmark button just after a take ends, the review UI should let the saved clip
resolve that bookmark without forcing the clip trim to include the late click or
trailing silence. Related clips should be inferred from source session and time
range context instead of storing a bookmark-to-clip id in the bookmark schema.

The session remains the source of truth until useful clips are extracted.
After extraction, saved clips are first-class music memo assets. A source
session remains valuable as provenance and surrounding context, but a saved
clip should remain usable even if its source session is later trashed,
offloaded, synced elsewhere, or permanently unavailable. By default, the
management library should keep source sessions as durable context rather than
treating them as disposable trim sources.

## Review UI

The review UI is part of the core product. If review is tedious, capture will
eventually produce clutter instead of useful music memos.

V1 review UI should support:

- session and clip browse tabs with count badges
- bookmarked/unbookmarked filters
- unresolved/resolved state
- session duration and created time
- editable session title with the original date-index still visible below it
- session notes
- waveform display
- visible bookmark markers
- playback
- bookmark markers select and seek to that timestamp, with a contextual state
  toolbar for unresolved, resolved, or dismissed
- previous/next bookmark navigation
- scrub and seek
- range selection
- save selected range as a clip
- edit saved clip titles and notes after creation
- support selecting the full session range when the whole session is worth
  keeping
- delete or mark source session resolved
- reversible review state controls: needs review, resolved, and dismissed
- restore recoverable sessions from trash before their purge date
- provide an out-of-the-way path to restore removed clips, because temporary
  retention should be recoverable through the UI and not only through an API

Potential later UI metadata:

- 5-star ratings for sessions and clips may be useful, but they should wait
  until title, notes, restore, and review-state flows feel stable enough that
  another ranking concept will not add noise

The UI should work from:

- phone on local network
- computer on local network

Remote access over Tailscale is desirable but can be a post-v1 networking
feature.

An iOS app should stay on the table as an alternate product shape. It may be
lighter than custom hardware if it can preserve the dedicated-recorder feel:
fast capture, obvious bookmark controls, low review friction, and strong
storage lifecycle rules so the phone does not accumulate unmanaged junk audio.

## Storage Lifecycle

Recordings should live on the recorder first, then be pushed to the management
host. The current preferred architecture is a thin recorder plus a management
server, likely on the Mac mini. In that shape, the management app is not
responsible for policing the user's general computer storage, and the prototype
does not need compression, lossy degradation, or an elaborate storage pressure
dashboard.

Recorder-local storage policy should stay small and conservative:

1. record raw WAV source sessions plus bookmark metadata
2. queue finished sessions for transfer to the management server
3. keep all unsynced or unacknowledged sessions on the recorder
4. after durable acknowledgement from the management server, mark the recorder's
   local copy safe to delete under pressure
5. if storage is low and no acknowledged local copies can be removed, block new
   recording and show a clear device status

The recorder free-space threshold should be configurable. A reasonable default
is to reserve enough space for a two-hour WAV recording at the configured
capture format, plus 512 MB for OS, metadata, logs, and transfer staging, with a
2 GB minimum reserve. This should cover a long accidental or exploratory
session without silently risking an unsynced take.

The management library should keep source sessions by default. Source sessions
are durable context, not disposable inputs for clip creation. The user may trash
or archive source sessions explicitly, but automatic cleanup in the management
app should not delete source audio just because clips were created.

Management-library trash behavior:

- sessions get the prominent trash/restore UI because they are large and carry
  source context
- removed clips get a lower-prominence restore path because they are durable
  memo assets but usually less costly to recreate while source context exists
- trash entries record deletion time and purge time
- garbage collection permanently removes trash entries only after the retention
  window expires
- restoring a clip should not require restoring its source session first; if
  source context is unavailable, the restored clip should stand alone with its
  source metadata marked unavailable

Compression was considered for an earlier all-in-one recorder/reviewer shape.
It should remain a design note, not an MVP requirement:

- raw WAV is simplest and highest quality
- FLAC may be useful later if the management host or an all-in-one recorder
  becomes storage constrained
- lossy degradation should not be part of the default workflow
- generic zip-style compression is unlikely to help much on raw audio compared
  with audio-specific formats

### Recorder Health

Recorder health is useful even if it is not part of the first management
prototype. A later manager view should be able to show:

- recorder online/offline status
- current recording state
- free recorder storage and estimated remaining recording time
- unsynced session count and bytes
- safe-to-delete acknowledged session count and bytes
- last successful transfer acknowledgement
- last sync error, if any
- recording blocked reason, if the recorder cannot safely reclaim space

## Sync and Long-Term Storage

Long-term storage should not depend on the device forever.

Likely path:

- recorder captures raw source sessions and bookmark metadata locally
- when online, the recorder pushes finished session bundles to the management
  server, likely the Mac mini on Tailscale or the local network
- the management server validates and durably stores the audio and metadata
- the management server returns an acknowledgement only after the session can be
  reconstructed from manager storage
- the recorder marks that local copy safe for deletion under pressure
- saved clips become first-class "music memos" inside the management library

Saved clips should remain independent assets. Their source session id and source
time range are provenance, not a requirement that the original source session
remain available forever. However, source sessions should be retained by default
on the management host as durable context.

Push from the recorder is preferred over manual import. Manual import should
exist only as a fallback for development, recovery, or offline transfer. Manager
polling is not the preferred MVP path.

MVP acknowledgement can stay simple: the recorder uploads a completed session
bundle, and the management server responds with success only after it has
validated and stored the audio plus metadata. A `200 OK` or `201 Created`
response with the manager session id is enough for the first version. The
recorder should not mark its local copy safe to delete until it receives that
success response.

Potential sync targets:

- Mac mini on Tailscale
- local network share
- cloud folder such as iCloud Drive or Dropbox
- AWS serverless storage and review hosting
- manual download from the web UI

AWS serverless is a credible long-term option for sync, storage, and the review
website. A possible shape would be object storage for audio and waveform
artifacts, a small metadata store for sessions/bookmarks/clips, presigned upload
or download URLs, and a static web UI. This should remain an option, not a v1
requirement, until the local capture/review loop proves itself.

V1 does not need to choose the final long-term storage architecture, but the
metadata model should include sync and source-availability state so the device
can grow into it.

## Recommended MVP Direction

The current preferred MVP is Track B: a dedicated, headless recorder that pushes
raw sessions to a management server, likely the Mac mini. Review happens from a
phone or computer browser pointed at the management server. The recorder should
not need to host the full review UI, waveform generation, clipping, compression,
or library-management workflow.

This keeps the capture loop dedicated while moving heavier work to a normal
computer:

1. press record on the device
2. play
3. press bookmark during promising sections
4. recorder writes `source.wav` and session/bookmark metadata locally
5. recorder pushes the finished session to the management server
6. management server acknowledges durable storage
7. open the management UI from phone or computer
8. review, trim, save clips, and keep the source session as context

This does mean review depends on the management host being available. That is
acceptable for the current direction because the Mac mini is the likely first
host, and keeping review off the recorder greatly simplifies board choice,
storage policy, and UI/server deployment. The all-in-one recorder/reviewer path
should remain possible, but it is no longer the default MVP assumption.

### Target board assumption

Assume the MVP recorder is a thin capture client. It should be comfortable
running:

- audio capture
- GPIO button/LED handling
- local session metadata writes
- a sync queue that pushes completed sessions to the management server
- recorder-local storage checks
- a small health/status endpoint or heartbeat
- Tailscale or local-network connectivity later

Recommended baseline:

- Raspberry Pi Zero 2 W or Raspberry Pi 4-class board for the recorder
- prefer Pi 4-class hardware if using a heavier USB audio interface, local
  buffering, or more complex networking
- USB storage or a high-quality microSD card sized for raw unsynced sessions
- wall power

The thin-recorder lifecycle is deliberately small: record locally, push audio and
metadata, mark sessions safe only after durable acknowledgement from the
management host, delete oldest acknowledged local copies when space is needed,
and block new recording when no safe local deletion remains.

The original Raspberry Pi Zero W should not be the preferred MVP target. It may
be able to perform a thin capture role, but its single-core CPU, 512MB RAM, and
USB constraints leave little margin.

Raspberry Pi 5 is acceptable if already available or if fast storage/performance
becomes important, but it is not the baseline. Its power/cooling expectations
and current pricing make it less attractive for a quiet dedicated recorder
unless the extra headroom is needed.

### Hardware plan

Use two hardware passes rather than trying to optimize the enclosure and board
choice immediately.

#### H0 bench recorder

Goal: prove recording, bookmarks, file integrity, and push sync with the least
hardware friction.

Recommended parts:

- Raspberry Pi 4 Model B, preferably 2 GB or 4 GB if available
- official USB-C power supply
- existing USB microphone or simple USB audio interface
- high-endurance 64 GB or larger microSD card, or USB storage if already handy
- two momentary buttons: record/stop and bookmark
- one prominent red recording LED with resistor
- simple breadboard or temporary enclosure

Why Pi 4 first:

- normal USB ports make USB microphones and storage easier
- Ethernet is available for reliable first sync tests
- CPU/RAM headroom keeps early software debugging separate from board limits
- the same capture/sync service can later move to a smaller board

H0 acceptance checks:

- boot directly into the recorder service
- press record to create a raw WAV session
- press bookmark to append timestamped bookmark metadata during recording
- press record again to close the session cleanly
- survive reboot without losing already-finished sessions
- push completed sessions to the management server and only mark local copies
  safe after acknowledgement
- block recording when free space is below the configured reserve and no
  acknowledged local copies can be deleted

#### H1 appliance recorder

Goal: shrink the recorder once the capture/sync loop works.

Candidate board:

- Raspberry Pi Zero 2 W is the preferred small-board candidate for a thin
  recorder because it has wireless networking, a 40-pin GPIO footprint, and
  enough CPU for capture plus sync
- Raspberry Pi 4 remains the fallback if USB audio, storage, or networking
  becomes annoying on the Zero 2 W

Audio options:

- easiest reliable path: keep using a USB microphone, with the Zero 2 W's USB
  OTG port and a known-good power supply
- compact integrated path: evaluate Raspberry Pi Codec Zero or a similar audio
  board, especially if its built-in microphone or external electret input is
  good enough for room-level idea capture
- quality fallback: use a better external USB microphone and accept the larger
  physical footprint

Controls and indicators:

- record/stop momentary button
- bookmark momentary button
- red recording LED
- optional later low-storage/sync status LED or terse display

Recorder software posture:

- native systemd service on Raspberry Pi OS Lite
- ALSA-based capture to WAV
- metadata writes that are safe across power loss
- local outbox of completed sessions
- HTTP push to the management server
- configurable manager URL and free-space reserve
- small health endpoint or heartbeat later, after MVP sync works

### Waveform posture

Waveform generation is not expected to be a hard product problem. For MVP, the
system only needs a visual overview good enough for scrubbing, bookmarks, and
trim selection.

Recommended approach:

- use a browser waveform library first, preferably WaveSurfer.js in the
  fixture-audio prototype
- use region/marker support for bookmark jumps and trim selection
- generate or cache simple peak-envelope JSON later if long files are slow in
  the manager UI
- generate cached waveforms lazily when a session is first opened, or during
  manager idle time after a session is ingested
- allow a placeholder/fake waveform in the fixture prototype only if audio
  tooling slows down early UI work

The risk is not that waveforms are conceptually difficult. With the management
server likely running on the Mac mini, long-file performance is less concerning
than it would be on a recorder-hosted UI. It should still be handled with
caching and background jobs so review stays responsive.

Peaks.js is a reasonable fallback if the UI becomes more annotation-heavy,
because it is designed around zoomable waveforms, point markers, and segment
markers. The first pass should still try WaveSurfer.js because it fits a
Vite/TypeScript frontend and has useful plugins for regions, hover, timeline,
and recording.

### Runtime packaging

Runtime packaging should stay flexible until the recorder board and sync stack
are chosen. The preferred management deployment is a container on the Mac mini,
with the library mounted as a normal host directory so audio files remain easy
to inspect and back up. Low-level capture on the recorder should be a native
service rather than a container unless containerization proves helpful later;
GPIO, audio devices, and boot-time behavior are simpler to own directly on the
recorder.

The preferred prototype stack is Vite, React/TSX, and TypeScript. A full-stack
TypeScript app is preferred for momentum, with a small Python backend kept as an
option only if audio processing or file operations are much simpler there.

## Architecture Tracks

There are four plausible product shapes. Track B is the current preferred MVP
direction, but the spec should keep the alternatives separate enough that the
project can change shape later without losing the review workflow.

### Track A: dedicated capture device hosting local review

The device records, stores sessions, hosts a local review web UI, and performs
trimming locally. It remains headless; review happens from a phone or computer
browser pointed at the device. Attaching a keyboard and monitor to the recorder
is not part of the product shape.

Advantages:

- strongest dedicated-recorder feel
- can work without another machine online
- local-first behavior is easy to reason about
- review still uses normal phone/computer screens

Risks:

- more work on the device
- board choice matters more
- waveform generation and trimming may push beyond a small Pi

### Track B: dedicated capture device plus Mac mini review

The device records locally and syncs sessions to the Mac mini when online. The
Mac mini hosts the review UI and performs heavier work such as waveform
generation and clip extraction.

This track is a natural fit to evaluate for a Pi Zero 2 W-class recorder. The
recorder is a durable capture appliance, while the Mac mini or another review
host owns the expensive and more iterative product surface.

Advantages:

- keeps the capture device simple
- Mac mini has plenty of power and stable Tailscale access
- easier to build a richer review UI without worrying about small-board limits
- removes the need for a compression-heavy storage lifecycle in the management
  app

Risks:

- review depends on sync and availability of the Mac mini
- offline review from the device is weaker
- sync acknowledgement must be robust because it controls whether the recorder
  can delete local copies under pressure

### Track C: iOS app or phone-first capture

The phone handles capture, bookmarks, local review, and possibly sync.

Advantages:

- no electronics required
- built-in battery, mic, screen, storage, and networking
- easier to iterate on review and management UI

Risks:

- less dedicated; opening an app may still feel like friction
- phone storage anxiety could recreate the problem
- background recording, file access, and sync constraints may shape the design
  in annoying ways

### Track D: AWS-backed review and storage

A device or app captures locally, then syncs to AWS for durable storage and a
hosted review website.

Advantages:

- review UI can be available anywhere
- durable off-device storage
- clean path to static hosting and object storage

Risks:

- more architecture before the capture/review loop is validated
- auth, upload reliability, costs, and privacy need decisions
- can distract from local ergonomics if introduced too early

## Prototype Definition Plan

Before writing production hardware or capture software, the product should prove
the review and management workflow with ordinary audio files. The first build
should have a narrow target, fixture data, concrete metadata, and acceptance
criteria that can be implemented without making electronics decisions.

### 1. First prototype target

Build a review/management prototype using sample audio files and bookmark
metadata.

This is the first target because it tests the part most likely to determine
whether the system stays useful: reviewing, trimming, saving, archiving,
source-session retention, trash, and organization. It also avoids electronics
while still defining the data contract that future capture hardware or apps
must produce and push to the management server.

The prototype should be a web app that can run against fixture files on a Mac or
development machine first, then on the Mac mini as the likely management host.
It should not require AWS, a phone app, or recorder hardware to validate the
review workflow.

The prototype may be Dockerized for local development so the dev loop does not
depend on Pi deployment. If so, the fixture/library directory should be mounted
as a volume and remain ordinary files outside the container.

Out of scope for the first prototype:

- physical record/bookmark buttons
- microphone selection
- live recording
- background recording
- sync implementation
- AWS deployment
- iOS-specific capture behavior

Other later build targets:

- recorder push client that uploads completed sessions to the management server
- manual import as a development/recovery fallback
- iOS capture/review app
- dedicated device capture stub plus minimal review

### 2. Define fixture data

Use a small set of fake or manually captured sessions before hardware exists.
The exact count is not important; the fixture set should cover the important
behaviors. A reasonable starting set is 7 sessions.

Fixtures should include:

- short unbookmarked session
- long unbookmarked session
- session with one bookmark
- session with several bookmarks
- session where the good clip is the full recording
- session with silence gaps
- recorder transfer or health simulation case

These fixtures let the review/management design be tested without committing to
microphones, buttons, boards, or sync machinery.

### 3. Specify the review workflow

The review workflow needs enough detail that it can be built without repeated
product decisions.

Required flow:

1. open session queue
2. pick a session
3. play from a bookmark or arbitrary waveform position
4. move to previous/next bookmark
5. select a trim range
6. save the range as a copied clip file
7. add or edit session notes
8. mark bookmarks resolved or dismissed
9. mark source session resolved, archived as context, or dismissed
10. verify that source sessions are retained by default and that source
    availability/sync status is visible

Important UI states:

- unreviewed session
- unbookmarked session
- bookmarked unresolved session
- resolved source session
- archived context session
- saved unsynced clip
- saved synced clip
- source session local
- source session unavailable
- recorder health warning later, once recorder sync exists

### 4. Specify recorder sync and source retention behavior

The manager should keep source sessions by default. The recorder should have a
small deterministic deletion policy so storage anxiety does not return on the
capture appliance.

The design should define:

- when a recorder-local session copy becomes safe to delete
- how the recorder reports free space, unsynced bytes, and sync errors
- how the manager represents local, remote, trashed, or unavailable source audio
- whether manager trash is only explicit user action in MVP
- how the UI explains source availability without implying source sessions are
  disposable

Starting policy:

- the recorder never deletes unsynced or unacknowledged sessions
- the management server keeps source sessions by default
- saved clips are never auto-deleted by the manager
- manager trash is explicit and recoverable for a retention window
- acknowledged recorder-local copies may be deleted under pressure
- recording blocks when the recorder cannot meet its free-space target without
  deleting unacknowledged sessions
- the free-space threshold is configurable and defaults to a two-hour recording
  reserve plus operating margin
- compression and lossy degradation are out of scope for the preferred MVP

### 5. Specify sync boundaries

Sync is not required for the first prototype, but the data model should not
paint the project into a corner.

The design should define:

- what object is synced: source session, saved clip, metadata, waveform cache,
  or all of them
- whether sync is push-only from capture device, pull-based from review server,
  or both
- how conflicts are handled if notes or states change in multiple places
- what "synced" means for deletion safety
- what happens when a session is partially synced

Likely early stance:

- recorder push to the management server is the MVP path
- manual import is a fallback, not the normal workflow
- manager polling is out of the preferred MVP path
- source sessions, clips, and metadata are durable assets on the manager
- waveform caches are rebuildable
- sync failure should never prevent capture
- `synced` means the management server returned success after storing the source
  audio and metadata needed to reconstruct the session
- the management server only needs to write acknowledgement and possibly health
  requests back to the recorder; review edits do not need to sync back in MVP

### 6. Specify capture interface contracts

Even before electronics, the review prototype should know what capture will
eventually produce.

Capture output contract:

- one audio file per source session
- one metadata record per session
- zero or more bookmark records with timestamps
- optional session note
- recording start and stop timestamps when available
- mic/input metadata when available
- optional origin recorder id when available
- transfer manifest or checksum when available

This keeps the future hardware client thin. Its job is to create session audio
and metadata reliably, push them to the management server, and keep local copies
safe until acknowledgement. The review system owns interpretation, cleanup, and
long-term organization.

For a single-recorder setup, the origin recorder id can be an internal constant
or omitted from the UI. It is mainly a future-proof provenance and diagnostics
field: if more than one recorder ever exists, it explains where a session came
from, helps diagnose sync/device issues, and avoids assuming every session came
from the same physical box.

## Implementation Readiness Criteria

Start implementation once the product spec has a concrete first build target
and acceptance criteria.

Ready when these are true:

- fixture data shape is specified
- session/bookmark/clip metadata schema is stable enough for one build
- source retention and sync/source availability states are specific enough to
  simulate
- first prototype acceptance criteria are written

The first implementation should target review and management workflow before
electronics. If that proves pleasant, the hardware recorder can remain a thin
capture client.

## First Prototype Contract

The first prototype is a review and management tool for fixture audio. It does
not record live audio. It proves that sessions can be reviewed quickly,
bookmarks can become clips, source sessions can remain durable context, and
sync/source availability states can be represented without touching electronics.

### Fixture layout

Use a file layout that resembles the future capture output:

```text
library/
  sessions/
    session-2026-05-02-001/
      session.json
      source.wav
    session-2026-05-02-002/
      session.json
      source.wav
  clips/
    clip-2026-05-02-001.wav
    clip-2026-05-02-001.json
  cache/
    waveforms/
      session-2026-05-02-001.json
  trash/
    sessions/
      session-2026-04-11-002/
        manifest.json
        session/
          session.json
          source.wav
        waveform.json
    clips/
      clip-2026-05-02-001/
        manifest.json
        clip-2026-05-02-001.wav
        clip-2026-05-02-001.json
```

Rules:

- `source.wav` is the original captured session audio.
- `session.json` owns session metadata and bookmark metadata.
- saved clips are copied audio files under `clips/`, not ranges that depend on
  the source session staying raw and local
- waveform cache files are rebuildable
- `trash/` contains recoverable sessions and removed clips until their
  retention window expires
- trash manifests include enough metadata to restore or explain why restore is
  limited
- the prototype may use manually created fixture audio

### Session metadata

Prototype `session.json` shape:

```json
{
  "id": "session-2026-05-02-001",
  "created_at": "2026-05-02T20:15:00-05:00",
  "title": "",
  "duration_seconds": 734.2,
  "audio_path": "source.wav",
  "state": "bookmarked",
  "retention_class": "review_pending",
  "source_availability": "local",
  "origin_device_id": "recorder-001",
  "compression_state": "raw_wav",
  "sync_state": "local_only",
  "notes": "",
  "bookmarks": [
    {
      "id": "bookmark-001",
      "timestamp_seconds": 182.4,
      "state": "unresolved",
      "note": ""
    }
  ],
  "clips": []
}
```

Required session states:

- `unreviewed`
- `bookmarked`
- `resolved`
- `dismissed`
- `archival_context`

Required retention classes:

- `throwaway`
- `review_pending`
- `archival_context`
- `protected`

Current optional compression states:

- `raw_wav`
- `flac`
- `lossy`
- `pending_compression`

Compression state exists in the current prototype metadata because an all-in-one
recorder/reviewer lifecycle was considered earlier. It should not drive MVP UI
work while the preferred direction is a Mac mini-hosted management app.

Required sync states:

- `local_only`
- `pending_sync`
- `synced`
- `sync_failed`

### Clip metadata

Prototype clip metadata shape:

```json
{
  "id": "clip-2026-05-02-001",
  "source_session_id": "session-2026-05-02-001",
  "source_start_seconds": 170.0,
  "source_end_seconds": 231.5,
  "audio_path": "clip-2026-05-02-001.wav",
  "created_at": "2026-05-02T21:02:00-05:00",
  "title": "",
  "notes": "",
  "sync_state": "local_only"
}
```

Saving a clip should:

1. copy audio into a new clip file
2. write clip metadata
3. link the clip id from the source session
4. move any resolved-by-context bookmarks to `resolved`
5. mark the source session `archival_context` unless the user dismisses it

Removing a clip should:

1. unlink it from the active source session if that session is available
2. move the copied clip audio and metadata to clip trash
3. leave bookmark review state unchanged
4. retain enough clip metadata to restore the clip as a standalone memo even if
   the source session is trashed or unavailable
5. purge the trashed clip only after the trash retention window

### Session queue behavior

The prototype queue should make review priority obvious.

Default ordering:

1. bookmarked unresolved sessions, newest first
2. unreviewed sessions, newest first
3. sessions with sync/source availability problems
4. archived context
5. dismissed or resolved sessions

Useful filters:

- needs review
- has bookmarks
- has saved clips
- archived context
- unbookmarked
- sync problem
- source unavailable

### Source And Recorder Status Behavior

The management prototype should emphasize source/session status over local
storage policing. A recorder health view is valuable later, once a real recorder
sync path exists.

Show:

- source session availability
- source session sync/import state
- origin recorder, when known
- unsynced or failed-transfer count, when recorder sync exists
- recorder free space and estimated recording time, later
- recording blocked reason, later

Actions:

- archive a session as context
- dismiss a session
- simulate sync success/failure
- restore trashed sessions and clips

### Prototype acceptance criteria

The prototype is successful when it can:

1. load fixture sessions from disk
2. show a session queue with review/source-status filters
3. render or fake a waveform for each session
4. show bookmark markers on the waveform
5. jump to bookmark, previous bookmark, and next bookmark
6. play from an arbitrary position
7. select a trim range
8. save the selected range as a copied clip with metadata
9. mark source sessions as resolved, dismissed, or archival context
10. add and edit session notes
11. simulate sync/source availability state changes
12. restore recoverable sessions and removed clips
13. keep source sessions available as durable context by default
14. leave recorder health and recording-blocked UI as a later integration point

## Data Model

### Session

Recommended fields:

- stable id
- created timestamp
- optional title
- duration
- audio path
- waveform/cache path
- recording device or mic name
- sample rate and channel count
- state
- retention class: throwaway, review_pending, archival_context, protected
- source availability: local, remote, trashed, unavailable
- optional origin recorder id or device name
- optional compression state only if constrained storage becomes important again
- optional notes
- bookmark ids
- saved clip ids
- sync state

### Bookmark

Recommended fields:

- stable id
- session id
- timestamp seconds
- created timestamp
- optional note
- state: unresolved, resolved, dismissed

### Clip

Recommended fields:

- stable id
- source session id
- source start seconds
- source end seconds
- audio path
- title
- notes
- created timestamp
- sync state

## Open Questions

- Which built-in microphone option is good enough for casual music idea
  capture?
- Should v1 support external USB mic selection, or merely tolerate one fixed
  attached mic?
- Is the default recorder free-space reserve of a two-hour WAV plus operating
  margin enough after testing with real capture settings?
- Should AWS serverless become the preferred long-term sync/storage destination,
  or remain one option beside the Mac mini?
- Should the device expose a normal Wi-Fi client UI, create a local hotspot
  when offline, or rely on known-network provisioning first?
