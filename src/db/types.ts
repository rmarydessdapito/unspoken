// Data model for unspoken. Everything lives on-device in IndexedDB.

export type VoicemailStatus =
  | 'recording' // a recorder is (or was, before a crash) actively writing chunks
  | 'draft' // an "unfinished thought" — can be resumed
  | 'saved' // a finished voicemail in "my unspoken"
  | 'deleted'; // in "recently deleted" — can be restored for DELETED_KEEP_DAYS

/** One continuous MediaRecorder session. A voicemail resumed from a draft gains a new segment. */
export interface Segment {
  id: string;
  mimeType: string;
  durationMs: number;
}

export interface Voicemail {
  id: string;
  status: VoicemailStatus;
  createdAt: number;
  /** user-editable "when was this recorded" timestamp */
  recordedAt: number;
  updatedAt: number;
  title: string;
  description: string;
  mood: string | null;
  tags: string[];
  coverId: string | null;
  photoIds: string[];
  durationMs: number;
  segments: Segment[];
  /** loudness peaks 0..1, ~PEAKS_PER_SECOND per second, finalized on finish */
  peaks: number[];
  transcript: string;
  transcriptVisible: boolean;
  prompt: string | null;
  /** future me: locked until this time */
  unlockAt: number | null;
  unlockSeen: boolean;
  lastPlayedAt: number | null;
  playCount: number;
  /** recently deleted: when, what it was before, and which collections it was in (to put it back) */
  deletedAt?: number | null;
  deletedFrom?: 'saved' | 'draft' | null;
  deletedCollections?: string[];
}

export const DELETED_KEEP_DAYS = 30;

/** A small piece of recorded audio, persisted every couple of seconds while recording. */
export interface Chunk {
  id?: number;
  voicemailId: string;
  segmentId: string;
  seq: number;
  blob: Blob;
  ms: number;
  peaks: number[];
}

export interface StoredImage {
  id: string;
  blob: Blob;
  createdAt: number;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  coverId: string | null;
  voicemailIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface Settings {
  onboarded: boolean;
  name: string;
  birthday: string | null; // "MM-DD"
  soundEffects: boolean;
  haptics: boolean;
  liveTranscription: boolean;
  remindersEnabled: boolean;
  reminderTime: string; // "HH:MM"
  lastReminderDate: string | null; // "YYYY-MM-DD"
  passcodeHash: string | null;
  passcodeSalt: string | null;
  biometricCredentialId: string | null;
  autoLockMinutes: number;
  libraryView: 'grid' | 'list';
  librarySort: SortKey;
  dismissedEchoes: Record<string, string>; // voicemailId -> date dismissed
  lastBackupAt: number | null;
  notifiedUnlocks: string[];
  /** wrong passcode guesses in a row, and when guessing is allowed again */
  failedUnlocks: number;
  lockoutUntil: number | null;
  echoFrequency: EchoFrequency;
  /** today's echo, so it stays the same all day and can be skipped for today only */
  echoToday: { date: string; id: string | null; skipped: boolean } | null;
  /** recent echoes, newest first, so the same voicemail doesn't keep coming back */
  echoHistory: { id: string; date: string }[];
  /** voicemails the user never wants resurfaced */
  neverEcho: string[];
  collectionSort: CollectionSortKey;
}

export type EchoFrequency = 'daily' | 'often' | 'weekly' | 'off';
export type CollectionSortKey = 'recent' | 'title' | 'size';

export type SortKey = 'newest' | 'oldest' | 'longest' | 'shortest' | 'played' | 'title';

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  name: '',
  birthday: null,
  soundEffects: true,
  haptics: true,
  liveTranscription: false,
  remindersEnabled: false,
  reminderTime: '21:00',
  lastReminderDate: null,
  passcodeHash: null,
  passcodeSalt: null,
  biometricCredentialId: null,
  autoLockMinutes: 5,
  libraryView: 'grid',
  librarySort: 'newest',
  dismissedEchoes: {},
  lastBackupAt: null,
  notifiedUnlocks: [],
  failedUnlocks: 0,
  lockoutUntil: null,
  echoFrequency: 'daily',
  echoToday: null,
  echoHistory: [],
  neverEcho: [],
  collectionSort: 'recent',
};

export const MOODS = ['calm', 'happy', 'grateful', 'hopeful', 'in love', 'nostalgic', 'tired', 'anxious', 'sad', 'heavy', 'angry', 'lost'] as const;
