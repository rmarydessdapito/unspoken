import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, requestPersistentStorage } from '../db/db';
import { setSetting, wipeEverything } from '../db/repo';
import type { EchoFrequency } from '../db/types';
import { Icon } from '../components/Icon';
import { Confirm, Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useLock } from '../components/LockGate';
import { useSettings } from '../hooks/useSettings';
import { exportBackup, importBackup, type BackupProgress } from '../lib/backup';
import { formatBytes, formatDate, greeting } from '../lib/format';
import { ECHO_FREQUENCY_LABELS } from '../lib/library';
import { biometricAvailable, hashPasscode, registerBiometric, verifyPasscode } from '../lib/lock';
import { askNotificationPermission, notificationsSupported } from '../lib/notify';
import { transcriptionSupported } from '../lib/transcription';
import { PageHeader } from './parts';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// february allows the 29th, so leap-day birthdays can be saved (they open on feb 28 in other years)
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" className="toggle" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

interface StorageInfo {
  usage: number;
  quota: number;
  audio: number;
  images: number;
  deleted: number;
  persisted: boolean;
}

async function measureStorage(): Promise<StorageInfo> {
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    const est = await navigator.storage?.estimate();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* unsupported */
  }
  const deletedIds = new Set(await db.voicemails.where('status').equals('deleted').primaryKeys());
  let audio = 0;
  let deleted = 0;
  await db.chunks.each((c) => {
    if (deletedIds.has(c.voicemailId)) deleted += c.blob.size;
    else audio += c.blob.size;
  });
  let images = 0;
  await db.images.each((i) => {
    images += i.blob.size;
  });
  return { usage, quota, audio, images, deleted, persisted };
}

type PinMode = 'set' | 'change' | 'remove';

export function You() {
  const s = useSettings();
  const toast = useToast();
  const { lockNow } = useLock();
  const deletedCount = useLiveQuery(() => db.voicemails.where('status').equals('deleted').count(), []) ?? 0;
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  const [current, setCurrent] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const restoreInput = useRef<HTMLInputElement>(null);
  const [bm, bd] = (s.birthday ?? '-').split('-');
  const maxDay = bm ? DAYS_IN_MONTH[Number(bm) - 1] : 31;

  useEffect(() => {
    measureStorage().then(setStorage);
    biometricAvailable().then(setBioOk);
  }, [deletedCount]);

  const runBackup = async () => {
    setBackupError(null);
    setProgress({ done: 0, total: 1, label: 'getting ready' });
    try {
      await exportBackup(setProgress);
      toast('backup saved. keep it somewhere safe.');
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') setBackupError("the backup didn't finish. nothing was changed — try again?");
    } finally {
      setProgress(null);
    }
  };

  const runRestore = async (file: File) => {
    setBackupError(null);
    setProgress({ done: 0, total: file.size, label: 'opening your backup' });
    try {
      const r = await importBackup(file, setProgress);
      toast(`restored ${r.voicemails} voicemails.`);
      setStorage(await measureStorage());
    } catch (err) {
      setBackupError((err as Error).message || "that backup couldn't be restored. nothing was changed.");
    } finally {
      setProgress(null);
    }
  };

  const closePin = () => {
    setPinMode(null);
    setCurrent('');
    setPin1('');
    setPin2('');
    setPinError(null);
  };

  const submitPin = async () => {
    setPinError(null);
    // changing or removing the lock needs the current passcode, so someone holding your unlocked phone can't turn it off
    if (pinMode !== 'set') {
      const ok = s.passcodeHash && s.passcodeSalt && (await verifyPasscode(current, s.passcodeHash, s.passcodeSalt));
      if (!ok) return setPinError("that's not your current passcode.");
      if (pinMode === 'remove') {
        await setSetting('passcodeHash', null);
        await setSetting('passcodeSalt', null);
        await setSetting('biometricCredentialId', null);
        closePin();
        return toast('lock removed. unspoken opens without a passcode now.');
      }
    }
    if (!/^\d{4,8}$/.test(pin1)) return setPinError('use 4 to 8 numbers.');
    if (pin1 !== pin2) return setPinError("those two don't match.");
    const { hash, salt } = await hashPasscode(pin1);
    await setSetting('passcodeSalt', salt);
    await setSetting('passcodeHash', hash);
    await setSetting('failedUnlocks', 0);
    closePin();
    toast(pinMode === 'change' ? 'passcode changed.' : 'unspoken is locked with your passcode.');
  };

  const usedPct = storage && storage.quota ? storage.usage / storage.quota : 0;
  const pinInput = (value: string, set: (v: string) => void, label: string, autoFocus = false) => (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input pin"
        inputMode="numeric"
        type="password"
        autoComplete={label.includes('current') ? 'current-password' : 'new-password'}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 8))}
      />
    </label>
  );

  return (
    <main className="screen you">
      <PageHeader title="you" eyebrow="private by default. always." />

      {/* one column on phones, two on wide screens */}
      <div className="panels">
        <section className="panel">
          <h2 className="panel-title serif">about you</h2>
          <label className="field">
            <span className="label">what should i call you? (optional)</span>
            <input className="input" value={s.name} maxLength={40} onChange={(e) => setSetting('name', e.target.value)} placeholder="just for greetings" />
          </label>
          {s.name.trim() && <p className="fine">the home screen will say: “{greeting(new Date(), s.name)}”</p>}
          <div className="field">
            <span className="label">your birthday — so “future me” can send a voicemail to it</span>
            <div className="field-row">
              <select
                className="input"
                value={bm || ''}
                aria-label="birthday month"
                onChange={(e) => {
                  const m = e.target.value;
                  if (!m) return setSetting('birthday', null);
                  const day = Math.min(Number(bd) || 1, DAYS_IN_MONTH[Number(m) - 1]);
                  setSetting('birthday', `${m}-${String(day).padStart(2, '0')}`);
                }}
              >
                <option value="">month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, '0')}>
                    {m}
                  </option>
                ))}
              </select>
              <select className="input" value={bd || ''} aria-label="birthday day" disabled={!bm} onChange={(e) => setSetting('birthday', `${bm}-${e.target.value}`)}>
                <option value="">day</option>
                {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
                  <option key={d} value={d}>
                    {Number(d)}
                  </option>
                ))}
              </select>
            </div>
            <p className="fine">only used to work out the date. no year needed, and it never leaves this device.</p>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">gentle reminders</h2>
          <Toggle
            label="a daily nudge"
            hint="a quiet “anything on your mind?” — never pushy"
            checked={s.remindersEnabled}
            onChange={async (v) => {
              if (v) {
                const perm = await askNotificationPermission();
                if (perm !== 'granted') {
                  toast(notificationsSupported() ? 'notifications are blocked for unspoken in your browser settings.' : "this browser can't show notifications.");
                  return;
                }
              }
              await setSetting('remindersEnabled', v);
            }}
          />
          {s.remindersEnabled && (
            <label className="field row-field">
              <span className="label">around</span>
              <input type="time" className="input" value={s.reminderTime} onChange={(e) => setSetting('reminderTime', e.target.value || '21:00')} />
            </label>
          )}
          <p className="fine">
            once a day at most. if you're already in unspoken at that time, it stays quiet. reminders and “future me” alerts can only arrive while
            unspoken is open or installed and running in the background — if your phone has put it to sleep, you'll see them the next time you open it.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">little echoes</h2>
          <label className="field row-field">
            <span className="label">echoes arrive</span>
            <select className="input" value={s.echoFrequency} onChange={(e) => setSetting('echoFrequency', e.target.value as EchoFrequency)}>
              {(Object.keys(ECHO_FREQUENCY_LABELS) as EchoFrequency[]).map((k) => (
                <option key={k} value={k}>
                  {ECHO_FREQUENCY_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <p className="fine">an older voicemail resurfaces on the home screen and in little echoes. nothing is sent anywhere.</p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">sound & feel</h2>
          <Toggle label="sound effects" hint="the beep when you start, a soft click when you finish" checked={s.soundEffects} onChange={(v) => setSetting('soundEffects', v)} />
          <Toggle
            label="haptics"
            hint={'vibrate' in navigator ? 'tiny vibrations when you start, pause and finish' : "this device doesn't support vibration"}
            checked={s.haptics}
            disabled={!('vibrate' in navigator)}
            onChange={(v) => setSetting('haptics', v)}
          />
        </section>

        <section className="panel">
          <h2 className="panel-title serif">transcripts</h2>
          <Toggle
            label="write down what i say while recording"
            hint={transcriptionSupported() ? `off by default · uses your device language (${navigator.language.toLowerCase()})` : "this browser doesn't offer speech recognition"}
            checked={s.liveTranscription && transcriptionSupported()}
            disabled={!transcriptionSupported()}
            onChange={(v) => setSetting('liveTranscription', v)}
          />
          <p className="fine disclosure">
            <Icon name="lock" size={14} /> heads up: this uses your browser's speech service. in chrome and edge that means google or microsoft servers hear your
            voice while you record. unspoken itself never uploads anything. the audio is always the real entry — you can also write or edit a transcript by hand
            on any voicemail, and transcripts are searchable.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">privacy & lock</h2>
          {s.passcodeHash ? (
            <>
              <p className="small">
                <Icon name="lock" size={14} /> unspoken asks for your passcode every time it opens.
              </p>
              <div className="btn-row">
                <button className="btn btn-ochre btn-sm" onClick={() => setPinMode('change')}>
                  change passcode
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPinMode('remove')}>
                  remove lock
                </button>
                <button className="btn btn-ghost btn-sm" onClick={lockNow}>
                  lock now
                </button>
              </div>
              {bioOk ? (
                <Toggle
                  label="unlock with face or fingerprint"
                  hint="your passcode still works too"
                  checked={!!s.biometricCredentialId}
                  onChange={async (v) => {
                    if (!v) return setSetting('biometricCredentialId', null);
                    try {
                      await setSetting('biometricCredentialId', await registerBiometric());
                      toast('face or fingerprint unlock is on.');
                    } catch {
                      toast("that didn't finish. nothing changed.");
                    }
                  }}
                />
              ) : (
                <p className="fine">face or fingerprint unlock isn't available on this device or browser.</p>
              )}
              <label className="field row-field">
                <span className="label">also lock after leaving for</span>
                <select className="input" value={s.autoLockMinutes} onChange={(e) => setSetting('autoLockMinutes', Number(e.target.value))}>
                  <option value={0}>no time at all</option>
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={60}>an hour</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <button className="btn btn-ochre" onClick={() => setPinMode('set')}>
                <Icon name="lock" size={16} /> set a passcode
              </button>
              <p className="fine">anyone who picks up your phone or laptop will need it to open unspoken.</p>
            </>
          )}
          <p className="fine">
            everything lives only on this device — no accounts, no profiles, no feed, no one listening. your recordings are protected at rest by your device's
            own storage encryption. nothing is shared unless you tap share and confirm.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">storage</h2>
          {storage ? (
            <>
              <div className="meter" aria-label={`${Math.round(usedPct * 100)}% of available space used`}>
                <span style={{ width: `${Math.min(100, usedPct * 100)}%` }} className={usedPct > 0.8 ? 'warn' : ''} />
              </div>
              <p className="small">
                {formatBytes(storage.audio)} of voice · {formatBytes(storage.images)} of photos
                {storage.quota > 0 && <span className="muted"> · {formatBytes(Math.max(0, storage.quota - storage.usage))} free for unspoken</span>}
              </p>
              {deletedCount > 0 && (
                <p className="small">
                  <Link to="/deleted" className="link">
                    recently deleted
                  </Link>{' '}
                  · {deletedCount} {deletedCount === 1 ? 'voicemail' : 'voicemails'}, {formatBytes(storage.deleted)} · erased automatically after 30 days
                </p>
              )}
              {usedPct > 0.8 && (
                <p className="error-note">
                  space is getting tight. make a backup, then free up space on your device. unspoken will never delete anything on its own.
                </p>
              )}
              <p className="small storage-status">
                <Icon name={storage.persisted ? 'check' : 'clock'} size={14} />{' '}
                {storage.persisted ? 'protected — your browser won’t clear unspoken to save space.' : 'not yet protected from your browser’s automatic clean-up.'}
              </p>
              {!storage.persisted && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    const ok = await requestPersistentStorage();
                    toast(ok ? 'protected.' : 'your browser decides this on its own — installing unspoken to your home screen usually helps.');
                    setStorage(await measureStorage());
                  }}
                >
                  ask the browser to protect it
                </button>
              )}
            </>
          ) : (
            <p className="muted small">measuring…</p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title serif">backup & export</h2>
          <p className="muted small">
            one file with every voicemail, photo, collection and setting (except your passcode). keep it in your cloud drive or on a computer, and restore it
            any time — even on a new device. to save a single recording as an audio file, use download on its page.
          </p>
          {s.lastBackupAt ? <p className="small">last backup: {formatDate(s.lastBackupAt)}</p> : <p className="small">you haven't made a backup yet.</p>}
          {progress ? (
            <div className="progress" role="progressbar" aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}>
              <div className="meter">
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <p className="small muted">{progress.label}…</p>
            </div>
          ) : (
            <div className="btn-row">
              <button className="btn btn-gold btn-sm" onClick={runBackup}>
                <Icon name="download" size={16} /> back up everything
              </button>
              <button className="btn btn-ochre btn-sm" onClick={() => restoreInput.current?.click()}>
                restore a backup
              </button>
            </div>
          )}
          {backupError && (
            <p className="error-note" role="alert">
              {backupError}
            </p>
          )}
          <input
            ref={restoreInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setRestoreFile(f);
            }}
          />
        </section>

        <section className="panel">
          <h2 className="panel-title serif">start over</h2>
          <p className="fine">erases every voicemail, draft, photo, collection and setting on this device, right away.</p>
          <button className="btn btn-danger btn-sm" onClick={() => setWipeOpen(true)}>
            delete everything
          </button>
        </section>
      </div>

      <p className="colophon">
        <span className="wordmark small-mark">unspoken</span>
        <br />
        for everything left unsaid. · v1.1
      </p>

      <Sheet open={!!pinMode} onClose={closePin} title={pinMode === 'remove' ? 'remove the lock?' : pinMode === 'change' ? 'change your passcode' : 'choose a passcode'}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            submitPin();
          }}
        >
          {pinMode !== 'set' && pinInput(current, setCurrent, 'your current passcode', true)}
          {pinMode !== 'remove' && (
            <>
              {pinInput(pin1, setPin1, pinMode === 'change' ? 'new passcode · 4–8 numbers' : '4–8 numbers', pinMode === 'set')}
              {pinInput(pin2, setPin2, 'once more')}
              <p className="fine">if you forget it, there's no way back in except clearing unspoken's data — so make a backup first.</p>
            </>
          )}
          {pinError && (
            <p className="error-note" role="alert">
              {pinError}
            </p>
          )}
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={closePin}>
              never mind
            </button>
            <button type="submit" className={`btn ${pinMode === 'remove' ? 'btn-danger' : 'btn-gold'}`}>
              {pinMode === 'remove' ? 'remove lock' : pinMode === 'change' ? 'change passcode' : 'set passcode'}
            </button>
          </div>
        </form>
      </Sheet>

      <Confirm
        open={!!restoreFile}
        onClose={() => setRestoreFile(null)}
        title="restore this backup?"
        body="voicemails, photos and collections from the backup are added back. if a voicemail is both here and in the backup, the backup's version is kept. nothing else is removed."
        confirmLabel="restore"
        onConfirm={() => restoreFile && runRestore(restoreFile)}
      />

      <Sheet open={wipeOpen} onClose={() => setWipeOpen(false)} title="delete everything?">
        <p className="muted sheet-body">
          every voicemail, draft, photo, collection and setting on this device will be erased — including recently deleted. this can't be undone.
          {s.lastBackupAt ? ` your last backup was ${formatDate(s.lastBackupAt)}.` : " you haven't made a backup."}
        </p>
        <label className="field">
          <span className="label">type “delete” to confirm</span>
          <input className="input" value={wipeText} onChange={(e) => setWipeText(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setWipeOpen(false)}>
            keep everything
          </button>
          <button
            className="btn btn-danger"
            disabled={wipeText.trim().toLowerCase() !== 'delete'}
            onClick={async () => {
              await wipeEverything();
              location.href = '/';
            }}
          >
            erase it all
          </button>
        </div>
      </Sheet>
    </main>
  );
}
