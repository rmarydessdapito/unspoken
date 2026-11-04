# unspoken

_for everything left unsaid._

unspoken is a private voice journal built around the feeling of leaving a voicemail. You tap one button, hear the beep, and talk — for ten seconds or two hours. Pause whenever you need to. When you're done, you can give it a title, a little context, a mood, tags, an album-style cover photo and more photos — or keep nothing but your voice. Over time it becomes a shelf of small album covers: different days, people, feelings, and versions of you.

There are no accounts, no profiles, no feed. Everything stays on your device.

---

## what's inside

| | |
|---|---|
| **leave a voicemail** | beep, live timer, live gold waveform, breathing mic. pause / resume / finish / cancel. no time limit. |
| **need a little help?** | 15 optional prompts, refreshable, never required. |
| **you got it out.** | optional title, description, mood, tags, recording date & time, cover art (upload, camera, crop & reposition, replace, remove), extra photos, future-me seal. |
| **my unspoken** | grid of framed covers or compact list; sort by newest, oldest, longest, shortest, recently played, a → z; search title, description, transcript, date, mood, tags, collection; filter by mood, tag, collection, date range and length. |
| **voicemail page** | large cover, interactive waveform (tap/drag/arrow keys to seek), ±10 s, 0.75×–2× speed, transcript (show / hide / edit / write), mood, tags, photos, edit, replace artwork, download, share (with a consent step), add to collections, delete. |
| **unfinished thoughts** | pause and save as a draft, leave, come back days later, continue where you stopped, finish as-is or delete. |
| **collections** | title, description, cover, many voicemails, reorder, edit, delete (the voicemails are never deleted). a voicemail can live in several. |
| **little echoes** | an older voicemail resurfaces each day (anniversaries first). listen again, keep in a collection, or "not today". also "on this day". |
| **future me** | seal a voicemail until tomorrow, next week, next month, your birthday, new year's day, or a date you choose. it can't be opened early. when it opens: _you have a voicemail from your past self. ♡_ |
| **you** | name, birthday, gentle daily reminder + time, sound effects, haptics, live transcription (with disclosure), passcode, biometric unlock, auto-lock, storage usage & protection, backup & restore, delete everything. |

---

## technology & architecture

**An installable web app (PWA): React 19 + TypeScript + Vite, storing everything on-device in IndexedDB (via Dexie).**

Why this fits:

- **Recording works everywhere it needs to.** `getUserMedia` + `MediaRecorder` are supported in current Chrome, Edge, Safari (iOS 14.3+ / macOS) and Firefox. Native pause/resume (`MediaRecorder.pause()`) keeps one continuous recording and never records paused time.
- **Long recordings are safe by design.** The recorder runs with a 2-second timeslice and writes every chunk to IndexedDB the moment it arrives, together with its measured duration and waveform peaks. Nothing waits in memory until "finish". If the tab crashes or the phone kills the app, the next launch turns the interrupted recording into an unfinished thought — at most the last ~2 s are lost. There is no duration limit anywhere in the code; the only ceiling is device storage (~43 MB per hour at 96 kbps Opus).
- **IndexedDB is real, persistent storage** (not `localStorage`), sized in gigabytes, and the app asks the browser to mark it persistent (`navigator.storage.persist()`) so it isn't evicted. Plus full backup/restore to a file you keep.
- **One codebase, installable on phones and desktops**, works offline (service worker), no app-store gatekeeping, no server to run or pay for, and nothing about your voice ever leaves the device.

```
┌──────────────── React UI (screens/, components/) ────────────────┐
│ Home · Record · Customize · Library · Detail · Drafts ·           │
│ Collection · Echoes · You · Onboarding · LockGate                 │
└───────┬───────────────┬──────────────────┬───────────────────────┘
        │               │                  │
  lib/recorder.ts   lib/player.ts     lib/library.ts (pure: search, sort,
  MediaRecorder →   one timeline over  echoes, future-me dates, peaks)
  chunks + peaks    1..n segments
        │               │
        └──── db/repo.ts (Dexie) ──── IndexedDB "unspoken"
              voicemails · chunks · images · collections · settings
```

- **Voicemail** = metadata + 1..n **segments**. Pausing never creates a new segment; only continuing a draft on another occasion does. Playback (`SegmentedPlayer`) treats segments as one seamless timeline; download/share produce one file (the original file for one segment, a joined WAV for several).
- **Waveforms** come from loudness peaks captured live while recording (10/s), so even an hour-long voicemail draws instantly without decoding audio.

---

## project structure

```
.
├── index.html                  app shell
├── package.json                scripts & dependencies
├── vite.config.ts              vite + PWA (manifest, offline cache) + vitest
├── tsconfig.json
├── .env.example                no secrets needed — documented as such
├── vercel.json                 SPA rewrite for vercel
├── public/
│   ├── icon.svg                app icon (gold mic in a gold frame)
│   ├── icon-maskable.svg
│   ├── sw-notify.js            notification-tap handler, imported into the service worker
│   └── _redirects              SPA fallback for netlify
├── src/
│   ├── main.tsx                boot: recover interrupted recordings, lock, render
│   ├── App.tsx                 routes + layout (nav, mini player, onboarding redirect)
│   ├── styles/global.css       the whole visual system (palette, type, components)
│   ├── db/
│   │   ├── types.ts            data model, settings defaults, moods
│   │   ├── db.ts               Dexie schema, persistent-storage request
│   │   └── repo.ts             all reads/writes: voicemails, chunks, images, collections, settings
│   ├── lib/
│   │   ├── recorder.ts         recording engine (chunked, crash-safe, pause/resume, drafts)
│   │   ├── player.ts           multi-segment playback, seek, ±10 s, speed
│   │   ├── library.ts          search, filters, sort, peaks downsampling, little echoes, future me
│   │   ├── backup.ts           streaming zip backup & restore
│   │   ├── audioExport.ts      single-file download / share, WAV join for multi-session voicemails
│   │   ├── images.ts           downscale, square crop
│   │   ├── lock.ts             PBKDF2 passcode, WebAuthn biometric unlock
│   │   ├── notify.ts           notifications & daily reminder logic
│   │   ├── transcription.ts    optional live transcription (Web Speech API)
│   │   ├── sounds.ts           synthesized beep / click, haptics
│   │   ├── prompts.ts          recording prompts & reminder lines
│   │   └── format.ts           durations, dates, greetings, default titles
│   ├── hooks/                  useSettings, usePlayer, useImageUrl, useNow
│   ├── components/             Cover, Waveform, CoverPicker (+crop), Fields, Sheet, Toast,
│   │                           BottomNav, MiniPlayer, VoicemailItem, CollectionPicker,
│   │                           LockGate, Background, ErrorBoundary, Icon
│   └── screens/                Onboarding, Home, Record, Customize, Detail, Library,
│                               Drafts, CollectionDetail, Echoes, You, parts
├── tests/
│   ├── library.test.ts         formatting, search/sort/filter, peaks, echoes, future me, reminders
│   └── repo.test.ts            persistence, crash recovery, cascade delete, collections, backup round-trip
└── scripts/e2e.mjs             end-to-end run in real Chrome with a fake microphone
```

---

## setup

Requirements: **Node.js 20+** (tested on 22) and npm.

```bash
npm install          # dependencies
npm run dev          # http://localhost:5173 — open on your phone via the network URL vite prints
```

- **Environment:** nothing to configure. `.env.example` exists only to say so.
- **Database:** none to initialise. IndexedDB is created automatically on first launch.
- **Permissions:** the browser asks for the **microphone** the first time you record. Notifications are only requested if you turn on reminders. Camera access is handled by the system photo picker.
- **HTTPS:** microphones, service workers and biometrics require a secure context. `localhost` counts; anywhere else (including testing on your phone over the LAN), serve over HTTPS — e.g. deploy, or run `npx vite --host` behind a tunnel such as `cloudflared tunnel --url http://localhost:5173`.

### build & deploy

```bash
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build locally
```

`dist/` is a static site. Deploy it anywhere that serves HTTPS with an SPA fallback:
Netlify (uses `public/_redirects`), Vercel (uses `vercel.json`), Cloudflare Pages, GitHub Pages (add a 404.html copy of index.html), or any static host. Then on a phone: open the URL → **Add to Home Screen** to install it as an app.

### tests

```bash
npm test                           # unit + data-layer tests (vitest, fake IndexedDB)
npm run build && npm run test:e2e  # full app in real Chrome with a fake microphone
LONG_MINUTES=20 npm run test:e2e   # … plus one continuous long recording
```

The e2e script needs Google Chrome or Chromium (set `CHROME_PATH` if it isn't in a standard place). Screenshots and a results log land in `e2e-artifacts/`.

---

## verification

Tested before delivery:

- **22 unit/data tests** pass — duration formatting up to multi-hour, greetings, default titles, search across title/description/transcript/tags/mood/collection, every sort, mood/tag/collection/duration filters, waveform downsampling of 36,000-peak recordings, little-echo selection (anniversaries first; never recent, dismissed or sealed), every future-me date, prompt refresh, reminder timing, rebuilding recordings from chunks, **crash recovery**, cascade deletes, collection reordering & multi-membership, collection deletion keeping voicemails, **backup → wipe → restore round-trip** (and lock secrets excluded), rejecting non-backup files.
- **End-to-end in real Chrome (36 checks)** — onboarding → first voicemail; recording starts immediately; timer counts; **pause freezes the timer, resume continues the same recording (one segment)**; paused time is excluded (stored and decoded audio duration both match the timer, not wall-clock time); live peaks captured; saved audio decodes as real audio; prompts; customise with title, description, mood, tag and **uploaded + cropped cover art**; detail page; **playback**, speed change, skip; **data survives a full reload**; search; grid/list toggle; collection create & add; **draft: pause → save → leave → continue later → finish** as one voicemail across two sessions with seamless playback; **closing the app mid-recording keeps it as a draft**; future-me seal is shown as locked and can't be opened early; storage view; no uncaught errors.
- **Long-duration recording:** a continuous 20-minute recording was made, finished, saved in full and played back from near the end. Because audio is persisted in 2-second pieces and nothing accumulates in memory, an hour or more behaves the same way — limited only by free storage.

Not testable in a headless environment, verified by code review only: camera capture (uses the OS camera picker via `capture`), biometric prompts, OS notifications, the Web Share sheet, and live transcription.

### what needs outside configuration / honest limits

| feature | status |
|---|---|
| recording, pause/resume, drafts, playback, artwork, photos, collections, search, echoes, future me, backup/restore, passcode | **fully implemented, on-device** |
| biometric unlock | implemented with WebAuthn platform authenticators (Face ID / Touch ID / Windows Hello / Android). needs HTTPS and a device that supports it; the toggle hides itself otherwise. |
| transcription | implemented with the browser's Web Speech API while recording — **off by default**, and disclosed in the app: in Chrome/Edge the browser sends live audio to Google/Microsoft for recognition. Firefox has no speech recognition. Transcripts can always be written/edited by hand. Transcribing an *already saved* recording would need an external speech-to-text service, which this build intentionally does not include. |
| reminders & future-me alerts | delivered while unspoken is open or installed and running in the background; unlocks that happen while it's closed are shown the next time it opens (nothing is ever missed). Guaranteed background push would require a push server, which a server-free private app deliberately avoids. |
| cloud backup | backups are a single .zip you save — to iCloud Drive, Google Drive, Dropbox or a computer — and restore on any device. Automatic cloud sync would require an account system and a server, which conflicts with "private, no accounts"; it isn't included. |
| encryption at rest | recordings are protected by the device's own storage encryption (default on modern iOS, Android, macOS FileVault, Windows BitLocker). The passcode keeps people out of the app; it does not add a second layer of file encryption. |
| iOS Safari | recording and playback work (AAC/mp4); iOS may suspend recording if you switch apps or lock the screen — whatever was captured up to that point is kept as a draft. The screen is kept awake during recording where supported. |

---

## privacy

- private by default. no accounts, profiles, followers, likes or feed.
- nothing leaves the device unless you tap **share** and confirm, or make a backup.
- the only third party that can ever hear audio is your browser's speech service, and only if you turn on live transcription.
- delete any voicemail, collection or everything at any time — deletion is real and immediate.

---

_every recording is a little time capsule._
