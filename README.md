# unspoken

*for everything left unsaid.*

![Screenshots of unspoken](docs/screenshots.png)

## About the Project

unspoken is a voice journal. Instead of writing entries, you record them like voicemails to yourself.

The idea came from how hard it can be to write down what you feel. Sometimes it's easier to just talk it out, like leaving a message for someone. With unspoken, you tap one button and speak, and your recording is kept in a private library on your device. No accounts, and unspoken never uploads your recordings.

## Features

- **Record with one tap**, with no time limit. You can pause and resume anytime.
- **Live timer and waveform** while you record.
- **Optional prompts** like "how are you, really?" if you don't know what to say.
- **Personalize recordings** with a title, description, mood, tags, a cover photo, and extra photos. All of these are optional.
- **Library** with grid or list view, sorting, search, and filters.
- **Playback** with skip forward/back 10 seconds and speeds from 0.75x to 2x.
- **Drafts** so you can stop in the middle and continue later.
- **Collections** to group recordings together.
- **Little echoes**, which bring back an older recording each day.
- **Future me**, which locks a recording until a date you choose.
- **Passcode lock**, with face or fingerprint unlock on supported devices. This is a screen lock, not encryption (see [Privacy and backups](#privacy-and-backups)).
- **Backup and restore** using a single `.zip` file. Backups are not encrypted.
- **Works on any screen.** Phones get a bottom bar, and tablets and computers get a wider layout with a sidebar.

## Technologies Used

- **TypeScript** – main programming language
- **React** – building the screens
- **CSS** – styling
- **Vite** – running and building the app
- **IndexedDB (with Dexie)** – saving recordings and photos in the browser
- **MediaRecorder API** – recording from the microphone
- **Vitest and Puppeteer** – testing

## Getting Started

You need [Node.js](https://nodejs.org) 22.18 or newer and [Git](https://git-scm.com/downloads).

```bash
git clone https://github.com/rmarydessdapito/unspoken.git
cd unspoken
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) and allow microphone access when asked.

No database or extra setup is needed.

## How to Use

1. Go through the short intro, then tap **leave your first voicemail**.
2. Talk after the beep. Use **pause**, **resume**, and **finish**.
3. Add a title, photo, or mood if you want, then tap **keep it**.
4. Find your recordings in **my unspoken** and tap one to play it.
5. Use the **you** tab for settings, the passcode, and backups.

## Browser Support

This is a conservative statement of what has actually been checked. The project does not set a minimum browser version.

**Automated coverage (Chromium only).** Every push runs the unit tests (Node, with a simulated database), then an end-to-end test in desktop Chrome at phone size (390x844, plus 320x640 checks) and desktop size (1440x900), using a fake microphone. These runs do not use a real phone, real touch input or a real microphone.

**Not yet tested, so not claimed as supported** (manual testing still needed): Chrome on Android, Safari on iPhone, iPad and Mac, Firefox, and Edge.

**What the app needs.** A secure context (HTTPS, or `localhost`), the microphone (`getUserMedia`), `MediaRecorder` and IndexedDB. Where the browser offers them, it also uses a screen wake lock while recording, a save-file picker for backups (desktop Chrome and Edge), device biometrics (WebAuthn), notifications and speech recognition for optional transcripts.

**Known limitations**
- Recordings are saved in whichever audio format the browser provides (for example WebM or MP4). Restoring a backup on a different browser or device, and playing it there, has not been tested.
- How recordings behave when a phone call or another app interrupts the microphone has not been tested on real devices.
- Browsers can clear a site's saved data, and iPhones and iPads in particular may do so when space is low or a site has not been used for a while. Installing the app to the Home Screen is not a guarantee against this, so keep backups.
- The install icons are SVG only, so some platforms, such as the iOS Home Screen, may not show the app icon.
- With live transcripts turned on (off by default), Chrome and Edge send what the microphone hears to the browser's speech service. Recordings themselves are never uploaded by unspoken.

## Privacy and backups

- Your recordings and journal are stored only in your browser's storage on your device, with no accounts, and unspoken never uploads them.
- Live transcripts are off by default. If you turn them on, your browser's speech-recognition service may process what you say while you record (Chrome and Edge use a vendor service; see Browser Support). Sharing only happens when you tap share and confirm.
- The **passcode is a screen lock for the app, not encryption.** unspoken does not encrypt recordings, titles, notes or transcripts. Someone with enough access to the browser or device may be able to reach them. Whether that storage is encrypted depends on your device's own security.
- **Backup files are not encrypted.** The `.zip` holds your recordings as audio plus titles, notes, tags and transcripts in readable form. Keep it somewhere private and secure.
- On iPhone, open the app in Safari, tap Share, then **Add to Home Screen**. This does not guarantee your saved data will be kept, so make backups from the **you** tab regularly.

## Project Structure

```
unspoken/
├── src/
│   ├── screens/      the pages of the app
│   ├── components/   reusable parts like covers and the waveform
│   ├── lib/          recording, playback, search, backup and other logic
│   ├── db/           the database setup and saving/loading functions
│   └── styles/       the app's styling and colors
├── public/           app icons and hosting settings
├── tests/            unit tests
└── scripts/          the end-to-end browser test
```

## How It Works

- When you record, the app saves a small piece of audio **every 2 seconds** instead of waiting until you finish. If the app closes suddenly, the recording is kept as a draft.
- Pausing stops the recording without adding the paused time.
- Everything is saved in the browser's built-in database (IndexedDB), so it stays on your device.
- The waveform is drawn from how loud your voice was while recording.

## Concepts Applied

- React components and hooks
- TypeScript types and interfaces
- Async programming with `async`/`await`
- Storing data in the browser with IndexedDB
- Using browser features like the microphone and notifications
- Unit testing and end-to-end testing

## Future Improvements

- Transcribing recordings after they're saved
- Syncing recordings between devices
- Trimming the start or end of a recording
- More reliable reminders

## Author

**Made by** [@rmarydessdapito](https://github.com/rmarydessdapito)
