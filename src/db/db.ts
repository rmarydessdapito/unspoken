import Dexie, { type Table } from 'dexie';
import type { Chunk, Collection, SettingRow, StoredImage, Voicemail } from './types';

/**
 * The single on-device database.
 * - voicemails: metadata for every recording (drafts, saved, in-progress)
 * - chunks:     the audio itself, written every couple of seconds while recording
 * - images:     cover art + photo attachments (+ collection covers)
 * - collections, settings
 */
export class UnspokenDB extends Dexie {
  voicemails!: Table<Voicemail, string>;
  chunks!: Table<Chunk, number>;
  images!: Table<StoredImage, string>;
  collections!: Table<Collection, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'unspoken') {
    super(name);
    this.version(1).stores({
      voicemails: 'id, status, createdAt, recordedAt, updatedAt, durationMs, lastPlayedAt, unlockAt, *tags, mood',
      chunks: '++id, voicemailId, segmentId, [segmentId+seq]',
      images: 'id',
      collections: 'id, createdAt, updatedAt, *voicemailIds',
      settings: 'key',
    });
  }
}

export const db = new UnspokenDB();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
