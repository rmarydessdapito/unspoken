import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../hooks/useSettings';
import { verifyBiometric, verifyPasscode } from '../lib/lock';
import { Icon } from './Icon';

const LockContext = createContext<{ lockNow: () => void }>({ lockNow: () => {} });
export const useLock = () => useContext(LockContext);

/**
 * Covers the app with a lock screen when a passcode is set.
 * The app stays mounted underneath (opaque overlay), so an in-progress recording is never interrupted by locking.
 */
export function LockGate({ initiallyLocked, children }: { initiallyLocked: boolean; children: ReactNode }) {
  const s = useSettings();
  const [locked, setLocked] = useState(initiallyLocked);
  const hiddenAt = useRef<number | null>(null);
  const enabled = !!s.passcodeHash;

  useEffect(() => {
    if (!enabled) setLocked(false);
  }, [enabled]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (enabled && hiddenAt.current != null && Date.now() - hiddenAt.current >= s.autoLockMinutes * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, s.autoLockMinutes]);

  const lockNow = useCallback(() => enabled && setLocked(true), [enabled]);

  return (
    <LockContext.Provider value={{ lockNow }}>
      <div inert={locked && enabled ? true : undefined} aria-hidden={locked && enabled}>
        {children}
      </div>
      {locked && enabled && <LockScreen onUnlock={() => setLocked(false)} />}
    </LockContext.Provider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const s = useSettings();
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const tried = useRef(false);

  const tryBio = useCallback(async () => {
    if (s.biometricCredentialId && (await verifyBiometric(s.biometricCredentialId))) onUnlock();
  }, [s.biometricCredentialId, onUnlock]);

  useEffect(() => {
    if (s.biometricCredentialId && !tried.current) {
      tried.current = true;
      tryBio();
    }
  }, [s.biometricCredentialId, tryBio]);

  const submit = async (value: string) => {
    if (!s.passcodeHash || !s.passcodeSalt) return onUnlock();
    if (await verifyPasscode(value, s.passcodeHash, s.passcodeSalt)) onUnlock();
    else {
      setWrong(true);
      setPin('');
    }
  };

  const press = (d: string) => {
    setWrong(false);
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="unlock unspoken">
      <p className="wordmark">unspoken</p>
      <p className="tagline">for everything left unsaid.</p>
      <div className={`pin-dots ${wrong ? 'shake' : ''}`} aria-live="polite">
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <p className="small muted">{wrong ? "that's not it. try again." : 'enter your passcode'}</p>
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
          onChange={(e) => {
            setWrong(false);
            setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
          }}
        />
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button type="button" key={d} onClick={() => press(d)}>
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
          <button type="button" onClick={() => press('0')}>
            0
          </button>
          <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label="delete digit">
            <Icon name="back" />
          </button>
        </div>
        <button type="submit" className="btn btn-gold" disabled={pin.length < 4}>
          unlock
        </button>
      </form>
    </div>
  );
}
