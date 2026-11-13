/**
 * The plain-language privacy and backup wording shown in the app, kept in one place so it can be tested.
 * Keep it honest: the passcode is a screen lock (not encryption), nothing is encrypted by unspoken itself,
 * and installing to a home screen is never promised to protect saved data.
 */

/** Settings → under the passcode: what the lock does and does not do. */
export const LOCK_IS_NOT_ENCRYPTION =
  'the passcode is a screen lock for unspoken, not encryption. unspoken does not encrypt your recordings, titles, notes or transcripts — they are kept as they are in this browser’s storage on your device, and anyone with enough access to this browser or device could still reach them. whether that storage is encrypted depends on your device’s own security, like its passcode and disk encryption, so keep your device locked and up to date.';

/** Sidebar footer (wide screens). */
export const SIDEBAR_PRIVACY_NOTE = 'private by default. your journal stays in your browser.';
/** Home: the first line of the backup reminder, when there has never been a backup. */
export const BACKUP_NUDGE_NO_BACKUP = 'your voicemails are stored in this browser on your device.';

export const LOCAL_ONLY_NOTE =
  'your recordings and journal are stored only in this browser, on your device — no accounts, no profiles, no feed. unspoken never uploads them. live transcripts are off by default; if you turn them on, your browser’s speech-recognition service may process what you say while you record. nothing is shared unless you tap share and confirm.';

/** Settings → backup: shown directly above the “back up everything” button. */
export const BACKUP_NOT_ENCRYPTED_HEAD = 'this backup file is not encrypted.';
export const BACKUP_NOT_ENCRYPTED_BODY =
  'it holds your recordings as playable audio, along with your titles, notes, tags and transcripts in readable form. anyone who gets the file can open it and look inside, so keep it somewhere private and secure, and delete copies you no longer need.';

export const BACKUP_INTRO =
  'one file with every voicemail, photo, collection and setting (except your passcode). restore it any time — even on a new device. what’s saved in this browser shouldn’t be the only copy of something important, so back up every so often. to save a single recording as an audio file, use download on its page.';

/** Settings → storage, for iPhone and iPad only. */
export const IOS_GUIDANCE_TITLE = 'on iphone and ipad';
export const IOS_INSTALL_STEPS = 'to add unspoken to your home screen: open it in safari, tap the share button, choose “add to home screen”, then tap add.';
export const IOS_BACKUP_REASON =
  'iphones and ipads can clear a website’s saved data, for example when space runs low or a site hasn’t been used in a while, and adding unspoken to your home screen doesn’t guarantee that won’t happen. treat what’s saved here as one copy, not the only copy: back up every so often and keep the file somewhere private.';

export const PERSISTED_NOTE = 'protected from automatic clean-up. you can still lose it if you clear site data or remove the app.';
export const NOT_PERSISTED_NOTE = 'not yet protected from your browser’s automatic clean-up.';
export const PERSIST_DENIED_TOAST = 'your browser decides this on its own. regular backups are the safest protection.';

/** iPhone, iPad and iPod — including iPadOS, which identifies itself as a Mac but has a touch screen. */
export function isIosDevice(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number }): boolean {
  if (/iphone|ipad|ipod/i.test(nav.userAgent ?? '')) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** Already opened from the home screen (so the “add to home screen” steps aren't needed). */
export function isInstalledApp(env: { navigatorStandalone?: boolean; displayModeStandalone?: boolean }): boolean {
  return env.navigatorStandalone === true || env.displayModeStandalone === true;
}
