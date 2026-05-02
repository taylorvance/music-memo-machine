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
- Manage storage with safe deletion, compression, offload, and clear blocking
  behavior when no responsible space can be reclaimed
- Leave a clear path to off-device sync, especially to a Mac mini on Tailscale

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
7. Resolved source sessions become eligible for deletion after lifecycle rules.

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
- resolution state once the bookmark has been reviewed or captured

The session remains the source of truth until useful clips are extracted.

## Review UI

The review UI is part of the core product. If review is tedious, capture will
eventually produce clutter instead of useful music memos.

V1 review UI should support:

- session list
- bookmarked/unbookmarked filters
- unresolved/resolved state
- session duration and created time
- session notes
- waveform display
- visible bookmark markers
- playback
- click bookmark to jump to that timestamp
- previous/next bookmark navigation
- scrub and seek
- range selection
- save selected range as a clip
- support selecting the full session range when the whole session is worth
  keeping
- delete or mark source session resolved

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

Recordings should live locally first.

The device should avoid refusing to record when it can safely reclaim space. If
storage is low, it should first delete safe throwaway sessions, compress less
safe sessions, and offload or sync when possible. If no responsible space can be
reclaimed, blocking recording is better than silently deleting valuable context.

Suggested lifecycle states:

- `recording`: active capture
- `unreviewed`: finished session waiting for review
- `bookmarked`: session has at least one bookmark
- `resolved`: useful clips have been extracted or the session was intentionally
  dismissed
- `archival_context`: source session is retained because it contains bookmarks
  or produced clips, so the user can revisit surrounding context or expand a
  trim later
- `compressed`: source session has been converted from raw capture to a smaller
  archival form
- `synced`: session or clips have been copied off-device
- `deletable`: safe for rotation under retention rules

Space reclamation should prefer graceful degradation before deletion, especially
for sessions that may contain useful musical context. A possible pressure
ladder:

1. keep newest and bookmarked sessions as raw WAV
2. delete old unbookmarked sessions that have no notes, clips, or explicit keep
   markers
3. convert older unbookmarked sessions to FLAC
4. convert clipped/bookmarked source sessions to FLAC archival context
5. offload or sync archival context sessions when online
6. convert older low-priority source sessions to a lossy idea-grade format only
   if the user has allowed that policy
7. block new recording if all remaining data is protected and no space can be
   reclaimed responsibly

Deletion priority:

1. old unbookmarked sessions with no notes, bookmarks, clips, or keep marker
2. dismissed source sessions
3. resolved unbookmarked source sessions whose clips and metadata are synced
4. clipped/bookmarked source sessions only by explicit user action or an
   explicit aggressive-storage policy

The device should favor preserving bookmarked and clipped sessions as archival
context, not treating them as disposable source. Old unbookmarked sessions can
be cleanup candidates on a reasonable schedule. Saved clips should not be
deleted automatically while unsynced unless the user explicitly chooses that
policy.

The review UI should include storage and lifecycle management, not just playback
and trimming:

- show total storage, free space, and projected recording time
- show how much space is used by source sessions, archival context, clips,
  waveform caches, and other rebuildable artifacts
- identify safe deletion candidates
- identify compression candidates
- identify unsynced durable items
- allow manual archive, compress, sync, keep, dismiss, and delete actions
- explain why recording is blocked if no safe reclamation path remains

Compression remains open:

- raw WAV is simplest and highest quality
- FLAC may be a good archival format with lossless compression
- Opus/AAC may be good for small idea-grade clips if storage pressure matters
- generic zip-style compression is unlikely to help much on raw audio compared
  with audio-specific formats

The first prototype can record WAV and defer compression until storage pressure
is real.

## Sync and Long-Term Storage

Long-term storage should not depend on the device forever.

Likely path:

- device records and reviews locally
- saved clips become "music memos"
- a sync service watches for unsynced clips and sessions
- when online, sync delivers them to the Mac mini or another durable target
- synced items can be marked safe for local rotation

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
metadata model should include sync state so the device can grow into it.

## Recommended MVP Direction

The MVP should use Track A: a dedicated, headless capture device that also hosts
the local review web UI. Review happens from a phone or computer browser. Sync
to a Mac mini, AWS, or another destination should be an off-device backup and
storage-management path, not a requirement for reviewing a take.

This keeps the main loop self-contained:

1. press record on the device
2. play
3. press bookmark during promising sections
4. open the device's local web UI from phone or computer
5. review, trim, save clips, archive context, and manage storage

The Mac mini path remains valuable, but it should not be necessary for the MVP
to feel useful. If review requires a second always-on machine, the recorder is
less portable and less self-contained.

### Target board assumption

Assume a Raspberry Pi 4-class board for the MVP recorder/review host. The target
should be comfortable running:

- audio capture
- a local Vite-built web UI served from the device
- lightweight API/file operations
- waveform cache generation
- compression jobs
- storage lifecycle checks
- Tailscale or similar remote access later

Recommended baseline:

- Raspberry Pi 4 Model B or equivalent
- 2GB RAM minimum
- 4GB RAM preferred if buying or choosing from available boards
- USB storage or a high-quality microSD card sized for raw sessions and clips
- wall power

Raspberry Pi Zero 2 W remains interesting but should be treated as a stretch
target for the full local-review MVP. Its size and low power are attractive, but
512MB RAM, one USB OTG path, and limited CPU headroom make it a better candidate
for a thinner capture client after the review/lifecycle workflow is proven.

The original Raspberry Pi Zero W should not be an MVP target for local web
review. Its single-core CPU and 512MB RAM are too tight for the combined capture,
review, waveform, compression, and lifecycle-management role.

Raspberry Pi 5 is acceptable if already available or if fast storage/performance
becomes important, but it is not the baseline. Its power/cooling expectations
and current pricing make it less attractive for a quiet dedicated appliance
unless the extra headroom is needed.

### Waveform posture

Waveform generation is not expected to be a hard product problem. For MVP, the
system only needs a visual overview good enough for scrubbing, bookmarks, and
trim selection.

Recommended approach:

- use a browser waveform library first, preferably WaveSurfer.js in the
  fixture-audio prototype
- use region/marker support for bookmark jumps and trim selection
- generate or cache simple peak-envelope JSON later if long files are slow on
  the target board
- generate cached waveforms lazily when a session is first opened, or during
  idle time after a recording ends
- allow a placeholder/fake waveform in the fixture prototype only if audio
  tooling slows down early UI work

The risk is not that waveforms are conceptually difficult. The risk is small
device performance on long files, especially if waveform generation blocks the
UI or capture process. That can be handled with caching, background jobs, and
possibly a more capable board.

Peaks.js is a reasonable fallback if the UI becomes more annotation-heavy,
because it is designed around zoomable waveforms, point markers, and segment
markers. The first pass should still try WaveSurfer.js because it fits a
Vite/TypeScript frontend and has useful plugins for regions, hover, timeline,
and recording.

### Runtime packaging

Runtime packaging should stay flexible until the target board and capture stack
are chosen. The review service can be containerized if that helps development or
deployment, but containerization is not a product requirement. Low-level capture
may be simpler as a native service if GPIO, audio devices, or boot-time behavior
are easier to manage outside a container.

The preferred prototype stack is Vite, React/TSX, and TypeScript. A full-stack
TypeScript app is preferred for momentum, with a small Python backend kept as an
option only if audio processing or file operations are much simpler there.

## Architecture Tracks

There are four plausible product shapes. The spec should keep them separate
until the tradeoffs are clearer.

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
generation, compression, and clip extraction.

Advantages:

- keeps the capture device simple
- Mac mini has plenty of power and stable Tailscale access
- easier to build a richer review UI without worrying about small-board limits

Risks:

- review depends on sync and availability of the Mac mini
- offline review from the device is weaker
- storage lifecycle must be careful when sessions exist in two places

### Track C: iOS app or phone-first capture

The phone handles capture, bookmarks, local review, and possibly sync.

Advantages:

- no electronics required
- built-in battery, mic, screen, storage, and networking
- easier to iterate on review and lifecycle UI

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
the review and lifecycle workflow with ordinary audio files. The first build
should have a narrow target, fixture data, concrete metadata, and acceptance
criteria that can be implemented without making electronics decisions.

### 1. First prototype target

Build a review/lifecycle prototype using sample audio files and bookmark
metadata.

This is the first target because it tests the part most likely to determine
whether the system stays useful: reviewing, trimming, saving, archiving,
compressing, offloading, and cleaning up. It also avoids electronics while
still defining the data contract that future capture hardware or apps must
produce.

The prototype should be a web app that can run against fixture files on a Mac or
development machine first, then later run on the recorder itself if the chosen
board is capable enough. It should not require the Mac mini, AWS, or a phone app
to validate the workflow.

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

Other possible later build targets:

- Mac mini-hosted review app fed by manually copied sessions
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
- low-storage simulation case

These fixtures let the review/lifecycle design be tested without committing to
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
8. mark bookmarks captured or dismissed
9. mark source session resolved, archived as context, or dismissed
10. verify the source session's lifecycle status and storage behavior

Important UI states:

- unreviewed session
- unbookmarked session
- bookmarked unresolved session
- resolved source session
- archived context session
- saved unsynced clip
- saved synced clip
- storage pressure warning
- recording blocked until storage is resolved

### 4. Specify storage lifecycle behavior

Lifecycle should be deterministic enough that storage anxiety does not return.

The design should define:

- default retention window for unbookmarked sessions
- minimum free-space target
- compression thresholds
- which states are never auto-deleted
- whether lossy degradation applies to source sessions only, clips only, or both
- whether automatic bookmark-adjacent clip extraction is allowed under pressure
- when recording blocks instead of reclaiming more space
- how the UI explains what is safe to delete

Starting policy:

- saved clips are never auto-deleted before sync
- bookmarked unresolved sessions are preserved as long as possible
- old unbookmarked source sessions degrade before deletion
- source sessions that produced clips become archival context by default
- archived context can be compressed or offloaded before deletion is considered
- recording may block when only protected clips and archival context remain

Recommended configurable defaults:

- minimum free space target: 2 GB or 15% of storage, whichever is larger
- unbookmarked throwaway retention: 14 days
- unbookmarked sessions older than 3 days become compression candidates
- archival context older than 30 days can be compressed to FLAC
- lossy degradation is allowed only for unbookmarked throwaway source sessions
  by default
- saved clips and protected sessions are never automatically degraded to lossy
- recording blocks when the minimum free space target cannot be met without
  touching protected clips or archival context

These are starting defaults, not hard product decisions. They should be easy to
change in configuration, and the prototype should make the policy visible enough
to tune after using real recordings.

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

- clips and metadata are the durable assets
- clipped or bookmarked source sessions are archival context by default
- unbookmarked source sessions are temporary unless explicitly kept
- waveform caches are rebuildable
- sync failure should never prevent capture
- `synced` means the destination has durably acknowledged the item and metadata
  needed to reconstruct it
- source sessions, clips, and metadata can sync independently; deletion safety
  depends on the specific object being acknowledged

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

This keeps the future hardware client thin. Its job is to create session audio
and metadata reliably; the review system owns interpretation, cleanup, and
long-term organization.

## Implementation Readiness Criteria

Start implementation once the product spec has a concrete first build target
and acceptance criteria.

Ready when these are true:

- fixture data shape is specified
- session/bookmark/clip metadata schema is stable enough for one build
- lifecycle rules are specific enough to simulate
- first prototype acceptance criteria are written

The first implementation should target review and lifecycle workflow before
electronics. If that proves pleasant, the hardware recorder can remain a thin
capture client.

## First Prototype Contract

The first prototype is a review and lifecycle tool for fixture audio. It does
not record live audio. It proves that sessions can be reviewed quickly,
bookmarks can become clips, and storage pressure can be understood without
touching electronics.

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
```

Rules:

- `source.wav` is the original captured session audio.
- `session.json` owns session metadata and bookmark metadata.
- saved clips are copied audio files under `clips/`, not ranges that depend on
  the source session staying raw and local
- waveform cache files are rebuildable
- the prototype may use manually created fixture audio

### Session metadata

Prototype `session.json` shape:

```json
{
  "id": "session-2026-05-02-001",
  "created_at": "2026-05-02T20:15:00-05:00",
  "duration_seconds": 734.2,
  "audio_path": "source.wav",
  "state": "bookmarked",
  "retention_class": "review_pending",
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

Required compression states:

- `raw_wav`
- `flac`
- `lossy`
- `pending_compression`

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
4. move any captured bookmarks to `captured`
5. mark the source session `archival_context` unless the user dismisses it

### Session queue behavior

The prototype queue should make review priority obvious.

Default ordering:

1. bookmarked unresolved sessions, newest first
2. unreviewed sessions, newest first
3. storage pressure candidates
4. archived context
5. dismissed or resolved sessions

Useful filters:

- needs review
- has bookmarks
- has saved clips
- archived context
- unbookmarked
- safe to delete
- compression candidate
- sync problem

### Storage dashboard behavior

The prototype should include a storage view, even if values are simulated.

Show:

- total library size
- free-space simulation value
- estimated recording time remaining
- source session size
- archival context size
- saved clip size
- waveform/cache size
- safe-delete total
- compression candidate total
- unsynced durable item count

Actions:

- delete safe throwaway sessions
- mark a session keep/protected
- archive a session as context
- dismiss a session
- simulate FLAC compression
- simulate lossy degradation if policy allows it
- simulate sync success/failure

Blocking rule:

- if simulated free space drops below the minimum target and no safe deletion,
  compression, or offload candidate remains, show `recording blocked`

### Prototype acceptance criteria

The prototype is successful when it can:

1. load fixture sessions from disk
2. show a session queue with lifecycle filters
3. render or fake a waveform for each session
4. show bookmark markers on the waveform
5. jump to bookmark, previous bookmark, and next bookmark
6. play from an arbitrary position
7. select a trim range
8. save the selected range as a copied clip with metadata
9. mark source sessions as resolved, dismissed, or archival context
10. add and edit session notes
11. show safe deletion and compression candidates
12. simulate sync state changes
13. show when recording would be blocked for storage reasons
14. keep clipped/bookmarked source sessions available as context

## Data Model

### Session

Recommended fields:

- stable id
- created timestamp
- duration
- audio path
- waveform/cache path
- recording device or mic name
- sample rate and channel count
- state
- retention class: throwaway, review_pending, archival_context, protected
- compression state
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
- state: unresolved, captured, dismissed
- resulting clip id if captured

### Clip

Recommended fields:

- stable id
- source session id
- source start seconds
- source end seconds
- audio path
- title
- created timestamp
- sync state

## Open Questions

- Which built-in microphone option is good enough for casual music idea
  capture?
- Should v1 support external USB mic selection, or merely tolerate one fixed
  attached mic?
- Are the proposed storage defaults right after testing with real fixture audio?
- Should AWS serverless become the preferred long-term sync/storage destination,
  or remain one option beside the Mac mini?
- Should the device expose a normal Wi-Fi client UI, create a local hotspot
  when offline, or rely on known-network provisioning first?
