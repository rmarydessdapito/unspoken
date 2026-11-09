# unspoken

*for everything left unsaid.*

![Screenshots of unspoken: home, recording, paused, customizing, playback and library screens](docs/screenshots.png)

## About the Project

unspoken is a private voice journal. Instead of typing journal entries, you record them as voicemails, a bit like leaving a message for yourself.

I made it because some thoughts are easier to say out loud than to write down. A late-night thought, a memory you don't want to forget, or something you never got to tell someone can be hard to put into words on a page. With unspoken, you just press one button and talk.

Every recording is saved like a small album in your own library, with its own title, cover photo and description if you want them. Over time, the library turns into a collection of your thoughts and memories.

unspoken runs in a web browser and can be installed on a phone like a regular app. There are no accounts and no social features. Your recordings are saved only on your own device.

## Features

### Recording

- **One-tap recording.** Press "leave a voicemail", hear a short beep, and start talking.
- **No time limit.** Recordings can be a few seconds or over an hour long. The only limit is the free space on your device.
- **Pause and resume.** You can pause as many times as you like. It stays one recording, and the paused time is not included.
- **Live timer and waveform.** A timer and a moving gold waveform show that the app is listening.
- **Optional prompts.** If you don't know what to say, the app can suggest a question like "how are you, really?" There are 15 prompts, and you can shuffle them.

### Personalizing a recording

After you finish recording, you can add:

- a title and a short description
- a mood (for example: calm, happy, nostalgic, tired)
- your own tags
- a cover photo that you can crop and reposition, like an album cover
- extra photos
- a different date and time for the recording

All of these are optional. You can save a recording without typing anything.

### My unspoken (the library)

- **Grid or list view.** See your recordings as square covers or as a compact list.
- **Sorting.** Sort by newest, oldest, longest, shortest, recently played, or title (A to Z).
- **Search.** Search by title, description, transcript, date, mood, tag, or collection name.
- **Filters.** Narrow the list by mood, tag, collection, date range, or length.

### Listening back

- A detail page with a large cover, title, date, description, mood and tags.
- A waveform you can tap or drag to jump to any part of the recording.
- Buttons to go back or forward 10 seconds.
- Playback speeds of 0.75x, 1x, 1.25x, 1.5x and 2x.
- A small player that stays at the bottom of the screen while you browse.
- Options to edit, download, share, add to a collection, or delete. Sharing always asks you to confirm first.

### Unfinished thoughts (drafts)

- Pause a recording and save it as a draft.
- Come back later and continue from where you stopped.
- Finish a draft as it is, or delete it.

### Collections

- Group recordings into collections like "late night thoughts" or "people i love".
- Each collection has a title, description, and cover photo.
- You can reorder the recordings in a collection.
- One recording can be in more than one collection.
- Deleting a collection does not delete the recordings inside it.

### Little echoes

- Each day, the app brings back one older recording (at least a week old), for example "a little echo from a year ago".
- Recordings from the same date in an earlier year are shown first.
- You can listen again, save it to a collection, or tap "not today" to skip it.

### Future me

- Lock a recording until a future date: tomorrow, next week, next month, your birthday, New Year's Day, or a date you choose.
- A locked recording can't be opened until that date.
- When the date arrives, the home screen shows "you have a voicemail from your past self. ♡"

### Settings ("you" tab)

- Your name (used in the greeting) and your birthday (used for "future me").
- An optional daily reminder at a time you choose.
- Sound effects and vibration on or off.
- Optional live transcription while recording.
- A passcode lock, with face or fingerprint unlock on devices that support it.
- How much storage your recordings use.
- Backup and restore of everything as a single `.zip` file.
- An option to delete everything.

## Technologies Used

| Technology | What it's used for |
|---|---|
| **TypeScript** | The main programming language. It's JavaScript with types, which helps catch mistakes early. |
| **React** | Building the screens and buttons out of reusable pieces called components. |
| **React Router** | Moving between pages (home, library, recording, etc.) without reloading the website. |
| **Vite** | Running the app while developing and building the final version. |
| **CSS** | All the styling, colors and animations. |
| **Dexie** | A helper library for IndexedDB, the database built into every browser. This is where recordings and photos are saved. |
| **MediaRecorder API** | The browser's built-in tool for recording from the microphone. |
| **Web Audio API** | Measuring how loud your voice is (for the waveform) and playing the beep sound. |
| **vite-plugin-pwa** | Making the app installable on a phone and usable offline. |
| **fflate** | Creating and reading the `.zip` backup files. |
| **Vitest** | Running the unit tests. |
| **Puppeteer** | Running an automatic end-to-end test in a real Chrome browser. |

The fonts are Cormorant Garamond for headings and DM Sans for everything else.

## Getting Started

### What you need

- [Node.js](https://nodejs.org) version **22.18 or newer**. The current LTS version works.
- [Git](https://git-scm.com/downloads), to download the project.
- A web browser such as Chrome, Edge, Safari or Firefox.
- A microphone.

### Steps

1. **Download the project.** Open a terminal and run:

   ```bash
   git clone https://github.com/rmarydessdapito/unspoken.git
   cd unspoken
   ```

2. **Install the dependencies.** This downloads the libraries the project needs:

   ```bash
   npm install
   ```

3. **Start the app:**

   ```bash
   npm run dev
   ```

4. **Open it in your browser** at [http://localhost:5173](http://localhost:5173).

5. When the browser asks for microphone access, click **Allow**.

You don't need to set up a database, API keys or environment variables. The database is created automatically the first time you open the app.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app for development. |
| `npm run build` | Checks the code for type errors and builds the final version into the `dist` folder. |
| `npm run preview` | Runs the built version locally. |
| `npm run typecheck` | Checks the code for type errors only. |
| `npm test` | Runs the unit tests. |
| `npm run test:e2e` | Runs the end-to-end test in Chrome. Run `npm run build` first. Needs Google Chrome or Chromium installed. |

### Using it on a phone

Browsers only allow microphone access on secure (`https://`) websites, or on `localhost`. This means opening the development server from your phone using your computer's local network address usually won't work.

The easiest way to try it on a phone is to put it online for free:

1. Sign in to [Vercel](https://vercel.com) with your GitHub account.
2. Click **Add New → Project**, choose this repository, and click **Deploy**.
3. Open the link Vercel gives you on your phone.
4. To install it like an app: on iPhone, tap **Share → Add to Home Screen** in Safari. On Android, tap **Install app** in Chrome.

The project also includes the settings needed for [Netlify](https://netlify.com). Each person who uses the link has their own private recordings on their own device.

## How to Use

1. **First launch.** You'll see four short intro screens. On the last one, tap **leave your first voicemail →**.
2. **Record.** You'll hear a beep, and the screen says "go ahead. i'm listening." Start talking.
   - Tap **pause** to take a break and **resume** to continue.
   - Tap **need a little help?** if you'd like a prompt.
   - Tap **finish** when you're done.
3. **Personalize.** On the "you got it out." screen, add a title, description, mood, tags or photos if you want. Tap **keep it** to save.
4. **Listen back.** Open any recording from the home screen or from **my unspoken** to play it, change the speed, or skip around.
5. **Organize.** In **my unspoken**, switch to the **collections** tab to create collections and add recordings to them.
6. **Save a draft.** While paused, tap **save as an unfinished thought**. It appears on the home screen under "unfinished thoughts", where you can continue it later.
7. **Send something to future you.** On the personalize screen, pick a date under **send it to future me?**
8. **Back up your recordings.** Go to **you → back up everything** to download a backup file. Use **restore a backup** to load it again, on the same device or a new one.

## Project Structure

```
unspoken/
├── index.html               The single HTML page the app loads into
├── package.json             Project info, commands and list of libraries
├── vite.config.ts           Settings for Vite, the installable app setup and tests
├── vercel.json              Settings for hosting on Vercel
├── public/                  Files served as-is (app icons, Netlify settings,
│                            notification click handler)
├── docs/                    Screenshots used in this README
├── src/
│   ├── main.tsx             Starting point: recovers interrupted recordings,
│   │                        checks the passcode lock, then shows the app
│   ├── App.tsx              Lists all the pages and the shared layout
│   ├── styles/global.css    All the styling and the color palette
│   ├── db/
│   │   ├── types.ts         Describes what a voicemail, collection and
│   │   │                    settings look like
│   │   ├── db.ts            Sets up the browser database
│   │   └── repo.ts          Functions for saving, loading and deleting data
│   ├── lib/
│   │   ├── recorder.ts      Recording from the microphone
│   │   ├── player.ts        Playing recordings back
│   │   ├── library.ts       Search, sorting, filters, little echoes and
│   │   │                    future me dates
│   │   ├── backup.ts        Backup and restore
│   │   ├── audioExport.ts   Creating a file for download or sharing
│   │   ├── images.ts        Resizing and cropping photos
│   │   ├── lock.ts          Passcode and fingerprint/face unlock
│   │   ├── notify.ts        Reminders and notifications
│   │   ├── transcription.ts Optional live transcription
│   │   ├── sounds.ts        The beep and click sounds, and vibration
│   │   ├── prompts.ts       The list of recording prompts
│   │   └── format.ts        Formatting times, dates and greetings
│   ├── hooks/               Small reusable React helpers
│   ├── components/          Reusable pieces of the interface (covers,
│   │                        waveform, navigation bar, mini player, etc.)
│   └── screens/             One file for each page of the app
├── tests/                   Unit tests and a sample cover image
└── scripts/e2e.ts           The automatic end-to-end browser test
```

## How It Works

### Saving recordings safely

The most important part of the app is making sure recordings don't get lost, even long ones.

Instead of keeping the whole recording in memory until you press finish, the recorder saves a small piece of audio every **2 seconds**. In `src/lib/recorder.ts`, the browser's recorder is started like this:

```ts
this.recorder.start(CHUNK_MS); // CHUNK_MS = 2000
```

Each time a new 2-second piece is ready, it's added to the database right away, along with how long it is and how loud it was.

While a recording is in progress, it's marked with the status `'recording'`. If the app is closed suddenly or crashes, that status is still there the next time it opens. On startup, the app looks for these and turns them into drafts, so you can finish them later:

```ts
export async function recoverInterruptedRecordings(): Promise<number> {
  const stuck = await db.voicemails.where('status').equals('recording').toArray();
  // each one is rebuilt from its saved pieces and kept as a draft
}
```

At most, the last couple of seconds are lost.

### Pause and resume

Pausing uses the browser recorder's own `pause()` and `resume()` functions. Nothing is recorded while paused, so the final recording doesn't include that time. The timer only counts the time you were actually recording.

If you save a draft and continue it later, the new part is saved as a second "segment". When you play it back, the player plays all the segments one after another, so it sounds like one recording.

### The waveform

While you record, the app measures how loud your voice is 10 times per second using the Web Audio API. These numbers are saved with the recording. Later, the waveform is drawn from these saved numbers, so it appears instantly, even for an hour-long recording.

### Where the data is stored

Everything is saved in **IndexedDB**, a database that's built into every modern browser. It can store large files like audio and photos. The database has five tables:

- **voicemails**: the title, description, mood, tags, dates and other details of each recording
- **chunks**: the actual audio, in 2-second pieces
- **images**: cover photos and other attached photos
- **collections**: your collections and which recordings are in them
- **settings**: your preferences

Since nothing is sent to a server, your recordings never leave your device unless you share them or make a backup.

### The time-based greeting

The home screen changes its greeting depending on the time of day. This is the actual function from `src/lib/format.ts`:

```ts
export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 0 && h < 5) return "it's late. what's on your mind?";
  if (h < 12) return 'good morning.';
  if (h < 18) return 'good afternoon.';
  if (h < 22) return 'good evening.';
  return "it's late. what's on your mind?";
}
```

### The passcode

The passcode itself is never saved. Instead, the app saves a "hash", which is a scrambled version of it that can't be turned back into the original. When you type your passcode, the app scrambles it the same way and checks whether the two match.

### Testing

The project has two kinds of tests:

- **Unit tests** (`npm test`): 22 tests that check smaller parts of the code, like search, sorting, the "future me" dates, crash recovery, collections, and backup and restore.
- **End-to-end test** (`npm run test:e2e`): opens the real app in Chrome with a fake microphone and goes through it like a user would: recording, pausing, saving, adding a cover photo, playing back, searching, creating a collection, using drafts, and recovering from a closed app.

## Learning Objectives / Concepts Applied

Building this project helped me practice:

- **Component-based UI** with React, where each part of the screen is its own reusable component.
- **React hooks**, including custom hooks like `useSettings` and `usePlayer`.
- **Client-side routing** with React Router.
- **TypeScript types and interfaces** to describe data such as `Voicemail` and `Collection`.
- **Asynchronous programming** with `async`/`await` and Promises, since recording, saving and playback all happen in the background.
- **Browser databases** (IndexedDB) for storing large files on the user's device.
- **Browser APIs** for the microphone, audio, notifications and file sharing.
- **Classes** to organize bigger pieces of logic, such as `VoicemailRecorder` and `SegmentedPlayer`.
- **Error handling**, so the app shows friendly messages instead of crashing, like when microphone access is denied.
- **Pure functions**, such as search and sorting, which take input and return output without side effects. This makes them easy to test.
- **Automated testing** with both unit tests and an end-to-end browser test.
- **Basic security** by storing a salted hash of the passcode instead of the passcode itself.

## Future Improvements

Some things I'd like to add later:

- **Transcribing saved recordings.** Right now, transcription only works live while recording. Transcribing a recording after it's saved would need a speech-to-text service.
- **Reliable reminders.** Reminders currently only work while the app is open or running in the background. Push notifications from a server would make them arrive on time.
- **Syncing between devices.** Recordings stay on one device right now. Moving them requires a manual backup and restore.
- **Trimming recordings.** A simple way to cut the start or end of a recording.
- **Extra encryption.** The app relies on the device's own storage encryption. Encrypting the recordings with the passcode would add another layer of protection.
- **Better transcription support in Firefox,** which doesn't have a built-in speech recognition feature.

## Author

**rmarydess**

GitHub: [@rmarydessdapito](https://github.com/rmarydessdapito)
