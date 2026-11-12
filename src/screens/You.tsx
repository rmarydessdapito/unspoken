import { useEffect, useRef, useState } from 'react';
import { db, requestPersistentStorage } from '../db/db';
import { setSetting, wipeEverything } from '../db/repo';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks/useSettings';
import { exportBackup, importBackup, type BackupProgress } from '../lib/backup';
import { formatBytes, formatDate } from '../lib/format';
import { biometricAvailable, hashPasscode, registerBiometric } from '../lib/lock';
import { askNotificationPermission, notificationsSupported } from '../lib/notify';
import { transcriptionSupported } from '../lib/transcription';
import { useLock } from '../components/LockGate';
import { PageHeader } from './parts';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

interface StorageInfo {
  usage: number;
  quota: number;
  audio: number;
  images: number;
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
  let audio = 0;
  await db.chunks.each((c) => {
    audio += c.blob.size;
  });
  let images = 0;
  await db.images.each((i) => {
    images += i.blob.size;
  });
  return { usage, quota, audio, images, persisted };
}

export function You() {
  const s = useSettings();
  const toast = useToast();
  const { lockNow } = useLock();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [bioOk, setBioOk] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const restoreInput = useRef<HTMLInputElement>(null);
  const [bm, bd] = (s.birthday ?? '-').split('-');

  useEffect(() => {
    measureStorage().then(setStorage);
    biometricAvailable().then(setBioOk);
  }, []);

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
      setBackupError((err as Error).message || "that backup couldn't be restored.");
    } finally {
      setProgress(null);
    }
  };

  const usedPct = storage && storage.quota ? storage.usage / storage.quota : 0;

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
          <div className="field">
            <span className="label">your birthday — for “future me” voicemails</span>
            <div className="field-row">
              <select
                className="input"
                value={bm || ''}
                aria-label="birthday month"
                onChange={(e) => setSetting('birthday', e.target.value ? `${e.target.value}-${bd && bd !== '' ? bd : '01'}` : null)}
              >
                <option value="">month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, '0')}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={bd || ''}
                aria-label="birthday day"
                disabled={!bm}
                onChange={(e) => setSetting('birthday', `${bm}-${e.target.value}`)}
              >
                <option value="">day</option>
                {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
                  <option key={d} value={d}>
                    {Number(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">gentle reminders</h2>
          <Toggle
            label="a daily nudge"
            hint="never pushy. just “anything on your mind?”"
            checked={s.remindersEnabled}
            onChange={async (v) => {
              if (v) {
                const perm = await askNotificationPermission();
                if (perm !== 'granted') {
                  toast(
                    notificationsSupported() ? 'notifications are blocked for unspoken in your browser settings.' : "this browser can't show notifications.",
                  );
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
            reminders and “future me” alerts arrive while unspoken is open or installed and running in the background. if your phone has put it to sleep, you'll
            see them the next time you open it — nothing is ever missed.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">sound & feel</h2>
          <Toggle label="sound effects" hint="the beep, the soft click" checked={s.soundEffects} onChange={(v) => setSetting('soundEffects', v)} />
          <Toggle label="haptics" hint="tiny vibrations, where supported" checked={s.haptics} onChange={(v) => setSetting('haptics', v)} />
        </section>

        <section className="panel">
          <h2 className="panel-title serif">transcripts</h2>
          <Toggle
            label="live transcription while recording"
            hint={transcriptionSupported() ? 'off by default' : "this browser doesn't offer speech recognition"}
            checked={s.liveTranscription && transcriptionSupported()}
            onChange={(v) => transcriptionSupported() && setSetting('liveTranscription', v)}
          />
          <p className="fine disclosure">
            <Icon name="lock" size={14} /> heads up: transcription uses your browser's speech service. in chrome and edge that means google or microsoft servers
            hear your voice while you record. unspoken itself never uploads anything. the audio always stays the real entry — you can also write or edit a
            transcript by hand.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">privacy & lock</h2>
          {s.passcodeHash ? (
            <>
              <p className="muted small">
                <Icon name="lock" size={14} /> unspoken is locked with a passcode.
              </p>
              <div className="btn-row">
                <button className="btn btn-ochre btn-sm" onClick={() => setPinOpen(true)}>
                  change passcode
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await setSetting('passcodeHash', null);
                    await setSetting('passcodeSalt', null);
                    await setSetting('biometricCredentialId', null);
                    toast('lock removed.');
                  }}
                >
                  remove lock
                </button>
                <button className="btn btn-ghost btn-sm" onClick={lockNow}>
                  lock now
                </button>
              </div>
              {bioOk ? (
                <Toggle
                  label="unlock with face or fingerprint"
                  checked={!!s.biometricCredentialId}
                  onChange={async (v) => {
                    if (!v) return setSetting('biometricCredentialId', null);
                    try {
                      await setSetting('biometricCredentialId', await registerBiometric());
                      toast('biometric unlock is on.');
                    } catch {
                      toast("biometric setup didn't finish.");
                    }
                  }}
                />
              ) : (
                <p className="fine">biometric unlock isn't available on this device or browser.</p>
              )}
              <label className="field row-field">
                <span className="label">lock after leaving for</span>
                <select className="input" value={s.autoLockMinutes} onChange={(e) => setSetting('autoLockMinutes', Number(e.target.value))}>
                  <option value={0}>immediately</option>
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={60}>an hour</option>
                </select>
              </label>
            </>
          ) : (
            <button className="btn btn-ochre" onClick={() => setPinOpen(true)}>
              <Icon name="lock" size={16} /> set a passcode
            </button>
          )}
          <p className="fine">
            everything lives only on this device — no accounts, no profiles, no feed, no one watching. your recordings are protected at rest by your device's
            own storage encryption. nothing is ever shared unless you tap share and confirm.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title serif">storage</h2>
          {storage ? (
            <>
              <div className="meter" aria-label="storage used">
                <span style={{ width: `${Math.min(100, usedPct * 100)}%` }} className={usedPct > 0.8 ? 'warn' : ''} />
              </div>
              <p className="small">
                {formatBytes(storage.audio)} of voice · {formatBytes(storage.images)} of photos
                {storage.quota > 0 && <span className="muted"> · {formatBytes(Math.max(0, storage.quota - storage.usage))} free for unspoken</span>}
              </p>
              {usedPct > 0.8 && (
                <p className="error-note">
                  space is getting tight. make a backup, then free up space on your device. unspoken will never delete anything on its own.
                </p>
              )}
              <Toggle
                label="protect from automatic clean-up"
                hint={storage.persisted ? 'on — your browser won’t evict unspoken' : 'asks your browser to never clear unspoken’s data'}
                checked={storage.persisted}
                onChange={async () => {
                  const ok = await requestPersistentStorage();
                  toast(ok ? 'protected.' : 'your browser decides this on its own — installing unspoken to your home screen usually helps.');
                  setStorage(await measureStorage());
                }}
              />
            </>
          ) : (
            <p className="muted small">measuring…</p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title serif">backup</h2>
          <p className="muted small">
            one file with every voicemail, photo and collection. keep it in your cloud drive or on a computer, and restore it any time — even on a new device.
          </p>
          {s.lastBackupAt && <p className="small">last backup: {formatDate(s.lastBackupAt)}</p>}
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
              if (f) runRestore(f);
            }}
          />
        </section>

        <section className="panel">
          <h2 className="panel-title serif">start over</h2>
          <button className="btn btn-danger btn-sm" onClick={() => setWipeOpen(true)}>
            delete everything
          </button>
        </section>
      </div>

      <p className="colophon">
        <span className="wordmark small-mark">unspoken</span>
        <br />
        for everything left unsaid. · v1.0
      </p>

      <Sheet
        open={pinOpen}
        onClose={() => {
          setPinOpen(false);
          setPin1('');
          setPin2('');
        }}
        title="choose a passcode"
      >
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!/^\d{4,8}$/.test(pin1)) return toast('use 4 to 8 numbers.');
            if (pin1 !== pin2) return toast("those don't match.");
            const { hash, salt } = await hashPasscode(pin1);
            await setSetting('passcodeSalt', salt);
            await setSetting('passcodeHash', hash);
            setPin1('');
            setPin2('');
            setPinOpen(false);
            toast('unspoken is locked with your passcode.');
          }}
        >
          <label className="field">
            <span className="label">4–8 numbers</span>
            <input
              className="input pin"
              inputMode="numeric"
              type="password"
              autoComplete="new-password"
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          <label className="field">
            <span className="label">once more</span>
            <input
              className="input pin"
              inputMode="numeric"
              type="password"
              autoComplete="new-password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          <p className="fine">if you forget it, there's no way back in except deleting everything — so make a backup first.</p>
          <div className="sheet-actions">
            <button type="submit" className="btn btn-gold">
              set passcode
            </button>
          </div>
        </form>
      </Sheet>

      <Sheet open={wipeOpen} onClose={() => setWipeOpen(false)} title="delete everything?">
        <p className="muted sheet-body">every voicemail, draft, photo, collection and setting on this device will be erased. this can't be undone.</p>
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
