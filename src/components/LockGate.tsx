import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { setSetting } from '../db/repo';
import { useSettings, useSettingsStatus } from '../hooks/useSettings';
import { useNow } from '../hooks/useNow';
import { lockoutDelayMs, verifyBiometric, verifyPasscode } from '../lib/lock';
import { Icon } from './Icon';

const LockContext = createContext<{ lockNow: () => void }>({ lockNow: () => {} });
export const useLock = () => useContext(LockContext);

/**
 * Covers the app with a lock screen when a passcode is set.
 * The app stays mounted underneath (opaque overlay), so an in-progress recording is never interrupted by locking.
 *
 * `initiallyLocked` comes from reading the database before the app renders, so the lock is up from the first frame.
 * We never treat "settings not loaded yet" as "no passcode".
 */
export function LockGate({ initiallyLocked, children }: { initiallyLocked: boolean; children: ReactNode }) {
  const { settings: s, loaded } = useSettingsStatus();
  const [locked, setLocked] = useState(initiallyLocked);
  const hiddenAt = useRef<number | null>(null);
  const enabled = !!s.passcodeHash;

  // only drop the lock when we *know* the passcode was removed
  useEffect(() => {
    if (loaded && !enabled) setLocked(false);
  }, [loaded, enabled]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (enabled && hiddenAt.current != null && Date.now() - hiddenAt.current >= s.autoLockMinutes * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, s.autoLockMinutes]);

  const lockNow = useCallback(() => enabled && setLocked(true), [enabled]);
  const show = locked && (enabled || !loaded);

  return (
    <LockContext.Provider value={{ lockNow }}>
      <div inert={show ? true : undefined} aria-hidden={show}>
        {children}
      </div>
      {show && (loaded ? <LockScreen onUnlock={() => setLocked(false)} /> : <div className="lock-screen" />)}
    </LockContext.Provider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const s = useSettings();
  const now = useNow(1000);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const tried = useRef(false);
  const waitMs = s.lockoutUntil ? Math.max(0, s.lockoutUntil - now) : 0;

  const unlock = useCallback(async () => {
    await setSetting('failedUnlocks', 0);
    await setSetting('lockoutUntil', null);
    onUnlock();
  }, [onUnlock]);

  const tryBio = useCallback(async () => {
    if (s.biometricCredentialId && (await verifyBiometric(s.biometricCredentialId))) unlock();
  }, [s.biometricCredentialId, unlock]);

  useEffect(() => {
    if (s.biometricCredentialId && !tried.current) {
      tried.current = true;
      tryBio();
    }
  }, [s.biometricCredentialId, tryBio]);

  const submit = async (value: string) => {
    if (!s.passcodeHash || !s.passcodeSalt || waitMs > 0 || checking) return;
    setChecking(true);
    try {
      if (await verifyPasscode(value, s.passcodeHash, s.passcodeSalt)) return unlock();
      const failed = s.failedUnlocks + 1;
      const delay = lockoutDelayMs(failed);
      await setSetting('failedUnlocks', failed);
      await setSetting('lockoutUntil', delay ? Date.now() + delay : null);
      setWrong(true);
      setPin('');
    } finally {
      setChecking(false);
    }
  };

  const press = (d: string) => {
    setWrong(false);
    setPin((p) => (p + d).slice(0, 8));
  };

  const message =
    waitMs > 0
      ? `too many tries. wait ${Math.ceil(waitMs / 1000)}s and try again.`
      : wrong
        ? "that's not it. try again."
        : 'enter your passcode';

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="unlock unspoken">
      <p className="wordmark">unspoken</p>
      <p className="tagline">for everything left unsaid.</p>
      <div className={`pin-dots ${wrong ? 'shake' : ''}`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <p className="small muted" aria-live="polite">
        {message}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(pin);
        }}
      >
        <input
          className="sr-only"
          aria-label="passcode"
          inputMode="numeric"
          type="password"
          autoFocus
          value={pin}
          disabled={waitMs > 0}
          onChange={(e) => {
            setWrong(false);
            setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
          }}
        />
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button type="button" key={d} onClick={() => press(d)} disabled={waitMs > 0}>
              {d}
            </button>
          ))}
          {s.biometricCredentialId ? (
            <button type="button" onClick={tryBio} aria-label="unlock with biometrics">
              <Icon name="fingerprint" />
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={() => press('0')} disabled={waitMs > 0}>
            0
          </button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="delete digit">
            <Icon name="back" />
          </button>
        </div>
        <button type="submit" className="btn btn-gold" disabled={pin.length < 4 || waitMs > 0 || checking}>
          unlock
        </button>
      </form>
      <p className="fine lock-forgot">
        forgot it? there's no way around the lock — that's what keeps it private. you can clear unspoken's data in your browser's site settings and
        restore a backup.
      </p>
    </div>
  );
}
