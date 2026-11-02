// Data model for unspoken. Everything lives on-device in IndexedDB.

export type VoicemailStatus =
  | 'recording' // a recorder is (or was, before a crash) actively writing chunks
  | 'draft' // an "unfinished thought" — can be resumed
  | 'saved'; // a finished voicemail in "my unspoken"

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
}

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
}

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
};

export const MOODS = ['calm', 'happy', 'grateful', 'hopeful', 'in love', 'nostalgic', 'tired', 'anxious', 'sad', 'heavy', 'angry', 'lost'] as const;
