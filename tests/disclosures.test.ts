import { describe, expect, it } from 'vitest';
import readme from '../README.md?raw';
import {
  BACKUP_INTRO,
  BACKUP_NUDGE_NO_BACKUP,
  BACKUP_NOT_ENCRYPTED_BODY,
  BACKUP_NOT_ENCRYPTED_HEAD,
  IOS_BACKUP_REASON,
  IOS_INSTALL_STEPS,
  isInstalledApp,
  isIosDevice,
  LOCAL_ONLY_NOTE,
  LOCK_IS_NOT_ENCRYPTION,
  NOT_PERSISTED_NOTE,
  PERSISTED_NOTE,
  PERSIST_DENIED_TOAST,
  SIDEBAR_PRIVACY_NOTE,
} from '../src/lib/disclosures';

const all = [LOCK_IS_NOT_ENCRYPTION, LOCAL_ONLY_NOTE, BACKUP_NOT_ENCRYPTED_HEAD, BACKUP_NOT_ENCRYPTED_BODY, BACKUP_INTRO, IOS_INSTALL_STEPS, IOS_BACKUP_REASON, PERSISTED_NOTE, NOT_PERSISTED_NOTE, PERSIST_DENIED_TOAST];

describe('privacy and backup wording', () => {
  it('says the passcode is a screen lock and not encryption, and that nothing is encrypted by unspoken', () => {
    expect(LOCK_IS_NOT_ENCRYPTION).toContain('screen lock');
    expect(LOCK_IS_NOT_ENCRYPTION).toContain('not encryption');
    for (const thing of ['recordings', 'titles', 'notes', 'transcripts']) expect(LOCK_IS_NOT_ENCRYPTION).toContain(thing);
    expect(LOCK_IS_NOT_ENCRYPTION).toContain('does not encrypt');
    expect(LOCK_IS_NOT_ENCRYPTION).toContain('anyone with enough access');
    expect(LOCK_IS_NOT_ENCRYPTION).toContain('depends on your device’s own security');
  });

  it('says a backup is not encrypted, what is readable in it, and to keep it private', () => {
    expect(BACKUP_NOT_ENCRYPTED_HEAD).toContain('not encrypted');
    const body = BACKUP_NOT_ENCRYPTED_BODY;
    for (const thing of ['audio', 'titles', 'notes', 'tags', 'transcripts', 'readable']) expect(body).toContain(thing);
    expect(body).toContain('anyone who gets the file can open it');
    expect(body).toContain('private and secure');
  });

  it('tells people the browser copy should not be their only copy', () => {
    expect(BACKUP_INTRO).toContain('shouldn’t be the only copy');
    expect(IOS_BACKUP_REASON).toContain('one copy, not the only copy');
  });

  it('never promises that installing to the home screen keeps the data, and has the real install steps', () => {
    expect(IOS_BACKUP_REASON).toContain('doesn’t guarantee');
    expect(IOS_INSTALL_STEPS).toMatch(/safari.*share.*add to home screen/);
    expect(PERSIST_DENIED_TOAST).not.toMatch(/home screen/);
    expect(PERSIST_DENIED_TOAST).not.toMatch(/usually helps/);
  });

  it('never claims that recordings are encrypted or protected at rest', () => {
    for (const line of all) {
      expect(line).not.toMatch(/protected at rest/);
      expect(line).not.toMatch(/(?<!not |n’t |does not )\bencrypted (at rest|by unspoken)/);
      expect(line).not.toMatch(/\b(unbreakable|military|secure vault|100% (safe|private))\b/);
    }
  });

  it('keeps the quiet, lowercase voice', () => {
    for (const line of all) expect(line).toBe(line.toLowerCase());
  });
});

describe('the local-storage note is accurate about transcription and sharing', () => {
  it('says recordings and journal data are stored locally, and unspoken does not upload them', () => {
    expect(LOCAL_ONLY_NOTE).toContain('stored only in this browser, on your device');
    expect(LOCAL_ONLY_NOTE).toContain('recordings and journal');
    expect(LOCAL_ONLY_NOTE).toContain('unspoken never uploads them');
  });
  it('says live transcription, when on, may be processed by the browser’s speech-recognition service', () => {
    expect(LOCAL_ONLY_NOTE).toContain('live transcripts are off by default');
    expect(LOCAL_ONLY_NOTE).toContain('if you turn them on');
    expect(LOCAL_ONLY_NOTE).toContain('your browser’s speech-recognition service may process what you say');
  });
  it('keeps sharing user-initiated', () => {
    expect(LOCAL_ONLY_NOTE).toContain('nothing is shared unless you tap share and confirm');
  });
  it('drops the absolute claims that transcription contradicts', () => {
    expect(LOCAL_ONLY_NOTE).not.toMatch(/everything lives only on this device/);
    expect(LOCAL_ONLY_NOTE).not.toMatch(/no one listening/);
    expect(LOCAL_ONLY_NOTE).not.toMatch(/nothing (is|gets) (uploaded|sent)/);
  });
  it('is consistent with the README privacy section and the rest of the README', () => {
    const privacy = readme.slice(readme.indexOf('## Privacy and backups'), readme.indexOf('## Project Structure'));
    expect(privacy).toContain('stored only in your browser');
    expect(privacy).toContain('unspoken never uploads them');
    expect(privacy).toMatch(/Live transcripts are off by default/);
    expect(privacy).toContain('speech-recognition service may process what you say');
    expect(privacy).toContain('Sharing only happens when you tap share and confirm');
    expect(readme).not.toMatch(/nothing (is|gets) uploaded/i);
    expect(readme).not.toMatch(/everything stays/i);
  });
});

describe('the sidebar and backup-reminder wording', () => {
  it('uses exactly the approved sidebar and reminder lines', () => {
    expect(SIDEBAR_PRIVACY_NOTE).toBe('private by default. your journal stays in your browser.');
    expect(BACKUP_NUDGE_NO_BACKUP).toBe('your voicemails are stored in this browser on your device.');
  });
  it('no longer says everything stays on, or lives only on, this device', () => {
    for (const line of [SIDEBAR_PRIVACY_NOTE, BACKUP_NUDGE_NO_BACKUP]) {
      expect(line).not.toMatch(/everything stays on this device/);
      expect(line).not.toMatch(/live only on this device/);
    }
  });
});

describe('iPhone and iPad detection', () => {
  it('recognises iPhone, iPad and iPod', () => {
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' })).toBe(true);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)' })).toBe(true);
  });
  it('recognises iPadOS, which reports itself as a Mac but has a touch screen', () => {
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });
  it('does not treat a real Mac, Android or Windows as an iPhone', () => {
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
    expect(isIosDevice({})).toBe(false);
  });
  it('knows when the app was opened from the home screen', () => {
    expect(isInstalledApp({ navigatorStandalone: true })).toBe(true);
    expect(isInstalledApp({ displayModeStandalone: true })).toBe(true);
    expect(isInstalledApp({ navigatorStandalone: false, displayModeStandalone: false })).toBe(false);
    expect(isInstalledApp({})).toBe(false);
  });
});
