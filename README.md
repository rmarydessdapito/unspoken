<div align="center">

# unspoken

### _for everything left unsaid._

A private voice journal built around the feeling of leaving a voicemail.

![unspoken — home, recording, paused, customizing, playback and library screens](docs/screenshots.png)

</div>

---

Some thoughts are easier to say than to write. So don't write them.

Open unspoken, tap **leave a voicemail**, hear the beep, and just talk — for ten seconds or two hours. Pause whenever you need to. When you're done, give it a title, a little context, a mood or a photo for its cover — or keep nothing but your voice.

Over time it becomes a shelf of small album covers: different days, people, feelings and versions of you.

**No accounts. No feed. No one listening.** Everything stays on your device.

## contents

- [quick start](#quick-start)
- [what you can do](#what-you-can-do)
- [how your voice is kept safe](#how-your-voice-is-kept-safe)
- [privacy](#privacy)
- [share it with someone](#share-it-with-someone)
- [browser support](#browser-support)
- [troubleshooting](#troubleshooting)
- [for developers](#for-developers)
- [testing](#testing)
- [known limits](#known-limits)

---

## quick start

You need [Node.js](https://nodejs.org) 20 or newer and [Git](https://git-scm.com/downloads).

```bash
git clone https://github.com/rmarydessdapito/project-unspoken
cd project-unspoken
npm install
npm run dev
```

Open **http://localhost:5173**, allow the microphone, and leave your first voicemail.

There is nothing else to set up: no database to create, no keys, no `.env` values.

---

## what you can do

### 🎙 leave a voicemail
- **one tap to start** — a soft beep, then _"go ahead. i'm listening."_
- **no time limit** — record a quick thought or an hour-long ramble
- **pause and resume** whenever you like; it stays one recording and paused time is never kept
- live timer, a breathing microphone and a gold waveform that moves with your voice
- **need a little help?** — fifteen optional prompts, like _"how are you, really?"_ or _"what do you wish you could say?"_

### 🖼 make it yours
After recording: _"you got it out. somewhere for this little piece of you."_
- a title, a description, a mood and tags
- **cover art** like an album sleeve — choose a photo or take one, crop and reposition it, replace or remove it any time
- more photos attached to the same voicemail
- change the date and time it was recorded
- every field is optional — you can save with nothing but your voice

### 📚 my unspoken
- your library as a **grid of framed covers** or a compact list
- sort by newest, oldest, longest, shortest, recently played or a → z
- **search** titles, descriptions, transcripts, dates, moods, tags and collection names
- filter by mood, tag, collection, date range and length

### ▶️ listen back
- large cover, title, date and description
- a waveform you can tap or drag to jump anywhere
- rewind and skip 10 seconds; speeds from 0.75× to 2×
- a mini player that follows you around the app
- download, share (only after you confirm), add to a collection, or delete

### 📝 unfinished thoughts
- pause, save as a draft and walk away
- come back hours or days later and **continue exactly where you stopped**
- finish it as it is, keep talking, or let it go

### 🗂 collections
- _people i love_, _late night thoughts_, _letters to future me_ — whatever you need
- each one has its own title, description and cover
- reorder voicemails inside it; one voicemail can live in several collections
- deleting a collection never deletes the voicemails in it

### 🌙 little echoes
- every day, an older voicemail finds its way back to you — anniversaries first
- _"a little echo from a year ago"_ → listen again, keep it in a collection, or say "not today"
- an **on this day** shelf for the same date in past years

### 💌 future me
- seal a voicemail until **tomorrow, next week, next month, your birthday, new year's day** or any date you choose
- sealed voicemails show as an envelope and can't be opened early
- when the day comes: _"you have a voicemail from your past self. ♡"_

### 🔒 you
- your name for greetings, and your birthday for future me
- an optional gentle daily reminder at a time you pick — never pushy
- sound effects and haptics on or off
- optional live transcription while you record (with a clear warning — see [privacy](#privacy))
- a passcode, plus face or fingerprint unlock where your device supports it
- how much space your voice is using, and protection from automatic clean-up
- back up everything to one file, and restore it on any device
- delete everything, for good, whenever you want

---

## how your voice is kept safe

Recording is the heart of unspoken, so it is built to never lose what you said.

- **Saved as you speak.** Audio is written to the device every two seconds while you record. Nothing waits in memory until you press finish.
- **Crashes don't erase anything.** If your phone kills the app, the battery dies or the tab closes mid-sentence, the recording comes back as an unfinished thought the next time you open unspoken. At most the last couple of seconds are lost.
- **Interruptions are handled.** If the microphone is cut off (a phone call, unplugged headphones), unspoken saves what it has as a draft and tells you.
- **Leaving asks first.** Trying to leave mid-recording asks whether to keep it as an unfinished thought, keep talking, or let it go.
- **No arbitrary limits.** The only ceiling is free space on your device — about 43 MB per hour of voice.
- **Nothing is ever deleted to make room.** If space runs low, unspoken warns you and keeps everything.
- **Backups you hold.** One `.zip` file contains every voicemail, photo and collection. Restore it later, or on a new phone.

---

## privacy

- **Private by default.** There are no accounts, profiles, followers, likes or public feed.
- **Nothing leaves your device** unless you tap **share** and confirm it, or make a backup yourself.
- **Live transcription is off by default.** If you turn it on, your browser's own speech service listens while you record. In Chrome and Edge that means Google's or Microsoft's servers hear your voice. The app tells you this before you switch it on.
- **The passcode is never stored**, only a salted hash. Face or fingerprint unlock is checked by your own device.
- **Your recordings are protected at rest** by your device's storage encryption, which is on by default on modern phones and computers.
- **Deleting is real.** Removing a voicemail removes its audio, cover and photos immediately.

---

## share it with someone

unspoken is a static website, so you can put it online for free and send people a link. Each person's voicemails stay on their own device; nobody can hear anyone else's.

**Vercel (easiest)**
1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, pick this repository and click **Deploy**. All the settings are detected automatically.
3. Send people the link you get, for example `https://project-unspoken.vercel.app`.

**Netlify** works the same way: **Add new site → Import from GitHub**. The `public/_redirects` file is already set up.

Any static host that serves HTTPS works: build with `npm run build` and upload the `dist/` folder.

**Installing it like an app:** on iPhone, open the link in Safari and tap **Share → Add to Home Screen**. On Android, open it in Chrome and tap **Install app**. It then opens full-screen and works offline.

---

## browser support

| | recording | playback | install as app | biometric unlock | live transcription |
|---|:-:|:-:|:-:|:-:|:-:|
| Chrome / Edge (desktop & Android) | ✓ | ✓ | ✓ | ✓ | ✓ ¹ |
| Safari (iPhone, iPad, Mac) | ✓ ² | ✓ | ✓ | ✓ | ✓ |
| Firefox | ✓ | ✓ | desktop: — | ✓ | — |

¹ processed by Google or Microsoft servers.
² iOS may pause recording if you switch apps or lock the screen. Everything captured up to that point is kept as an unfinished thought, and unspoken keeps the screen awake while recording where it can.

The microphone, installing and biometric unlock need a secure connection: `localhost` while developing, or any `https://` address once deployed.

---

## troubleshooting

**"unspoken needs your microphone to listen."**
The microphone permission was blocked. Click the lock or settings icon next to the address bar, allow the microphone for this site, and reload.

**It works on my computer, but the microphone won't start on my phone.**
Your phone is probably opening the dev server over plain `http://`, and phones only allow the microphone over `https://`. Deploy it ([share it with someone](#share-it-with-someone)), or use an HTTPS tunnel such as `cloudflared tunnel --url http://localhost:5173`.

**I can't find my recordings in a private / incognito window.**
Private windows erase their storage when they close. Use a normal window, or install unspoken to your home screen.

**I moved to a new phone.**
On the old phone: **you → back up everything**. On the new one: **you → restore a backup** and choose that file.

**I forgot my passcode.**
There's no way around it — that's the point of a lock. You can erase the app's data from your browser's site settings and restore your most recent backup. Backups never include the passcode.

**"face or fingerprint" doesn't appear.**
Your device or browser doesn't offer a built-in biometric sensor, or the page isn't on `https://`.

---

## for developers

### stack

| | |
|---|---|
| UI | React 19, TypeScript, React Router 7 |
| build | Vite 8, installable PWA via `vite-plugin-pwa` (offline support) |
| storage | IndexedDB through Dexie 4 — audio, images and data, all on-device |
| audio | `MediaRecorder` (Opus/WebM or AAC/MP4), Web Audio for waveform levels and sounds |
| backup | streaming `.zip` with fflate |
| security | Web Crypto (PBKDF2) for the passcode, WebAuthn for biometrics |
| fonts | Cormorant Garamond (headings) and DM Sans (interface), bundled for offline use |

**Why a web app?** One codebase runs on phones and computers, installs from a link without an app store, works offline, and needs no server — so there's nowhere for anyone's voice to leak to.

### how it fits together

```
 screens/ + components/  (React)
      │
      ├── lib/recorder.ts   MediaRecorder → 2-second chunks + loudness peaks → IndexedDB
      ├── lib/player.ts     plays 1..n recording sessions as one seamless timeline
      ├── lib/library.ts    search, sort, filters, little echoes, future me (pure functions)
      │
      └── db/repo.ts        all reads & writes
              │
         IndexedDB "unspoken":  voicemails · chunks · images · collections · settings
```

A **voicemail** is metadata plus one or more **segments**. Pausing never creates a new segment; only continuing a draft later does. Waveforms come from loudness peaks captured live during recording, so even hour-long voicemails draw instantly.

### project structure

```
src/
├── main.tsx              startup: recover interrupted recordings, lock, render
├── App.tsx               routes, layout, onboarding redirect
├── styles/global.css     the full visual system and palette
├── db/                   data model, database schema, data access
├── lib/                  recorder, player, library logic, backup, export,
│                         images, lock, notifications, transcription, sounds, prompts
├── hooks/                settings, player state, images, current time
├── components/           covers, waveforms, pickers, sheets, nav, mini player, lock screen
└── screens/              onboarding, home, record, customize, detail, library,
                          drafts, collection, echoes, you
public/                   icons, notification handler, hosting redirects
tests/                    unit and data-layer tests, sample cover art
scripts/e2e.mjs           end-to-end test in a real browser
docs/                     README screenshots
```

### palette

| | | |
|---|---|---|
| deep teal | `#19383B` | main background — the walls |
| muted ocean | `#07515C` | secondary surfaces |
| antique gold | `#B18118` | record button, waveforms, frames, active nav |
| warm ochre | `#89531F` | secondary buttons and accents |
| charcoal | `#292A28` | dark surfaces, text on light |
| warm cream | `#F1E9D9` | text on dark, reading surfaces |

### scripts

| command | what it does |
|---|---|
| `npm run dev` | start the dev server at http://localhost:5173 |
| `npm run build` | type-check and build into `dist/` |
| `npm run preview` | serve the production build locally |
| `npm test` | run unit and data-layer tests |
| `npm run test:e2e` | run the full app in Chrome with a fake microphone (build first) |
| `npm run typecheck` | type-check only |

---

## testing

```bash
npm test                            # 22 unit & data tests
npm run build && npm run test:e2e   # 36 end-to-end checks in real Chrome
LONG_MINUTES=20 npm run test:e2e    # …plus one continuous long recording
```

The end-to-end test needs Google Chrome or Chromium; set `CHROME_PATH` if it isn't in a standard place. Screenshots and a log are saved to `e2e-artifacts/`.

**What's covered**

- **recording** — starts on one tap, the timer counts, pause freezes it, resume continues the same recording, and paused time is excluded from both the saved length and the actual audio
- **saving** — title, description, mood, tags and an uploaded, cropped cover; the saved audio decodes as real sound
- **playback** — play, pause, speed and skipping, including across two separate sessions
- **persistence** — everything survives a full reload
- **library** — search, grid and list views, collections
- **drafts** — pause, save, leave, continue later, and finish as one voicemail
- **crash recovery** — closing the app mid-recording keeps it as a draft
- **future me** — sealed voicemails show locked and can't be opened early
- **data layer** — rebuilding recordings from chunks, cascade deletes, collection ordering, and a backup → wipe → restore round-trip
- **long recordings** — a continuous 20-minute recording was saved in full (589 chunks), then seeked near the end and played

Camera capture, biometric prompts, system notifications, the share sheet and live transcription can't run in a headless browser, so they were checked by hand and in code review only.

---

## known limits

| feature | how it works today |
|---|---|
| **reminders & future-me alerts** | arrive while unspoken is open or running in the background. If your phone put it to sleep, you'll see them the next time you open it — nothing is missed, it's just not guaranteed to buzz on time. Guaranteed background alerts would need a push server. |
| **cloud backup** | backups are a single file you save wherever you like (iCloud Drive, Google Drive, a computer). Automatic sync would need accounts and a server, which this app deliberately avoids. |
| **transcription** | live, while you record, using the browser's speech service. Firefox doesn't offer one. Transcribing an already-saved recording would need an external speech-to-text service, which isn't included. You can always write or edit a transcript by hand. |
| **encryption at rest** | relies on your device's own storage encryption. The passcode keeps people out of the app; it doesn't add a second layer of encryption to the files. |

---

<div align="center">

_every recording is a little time capsule._

**unspoken** · made by rmarydess

</div>
