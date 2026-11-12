import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { moveToDeleted, updateVoicemail } from '../db/repo';
import type { Voicemail } from '../db/types';
import { formatDate, formatTime, timeAgo, toDateInput, untilText } from '../lib/format';
import { MAX_UNLOCK_DATE, unlockDate } from '../lib/library';
import { Icon } from './Icon';
import { Confirm, Sheet } from './Sheet';
import { useToast } from './Toast';

/**
 * What you see when you open a sealed voicemail early. Nothing about its contents is shown —
 * only when it was sealed and when it opens. The date can only be pushed further away.
 */
export function SealedView({ vm }: { vm: Voicemail }) {
  const nav = useNavigate();
  const toast = useToast();
  const [later, setLater] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const minDate = toDateInput((vm.unlockAt ?? Date.now()) + 86_400_000);
  const newUnlock = newDate ? unlockDate('custom', { custom: newDate }) : null;
  const valid = newUnlock != null && newUnlock > (vm.unlockAt ?? 0);

  return (
    <div className="sealed-envelope fade-in">
      <Icon name="envelope" size={56} />
      <p className="serif display-sm">this one's sealed.</p>
      <p className="muted">
        you sealed it on {formatDate(vm.recordedAt)}. it opens <strong>{formatDate(vm.unlockAt!)}</strong> at {formatTime(vm.unlockAt!)} ·{' '}
        {untilText(vm.unlockAt!)}.
      </p>
      <div className="btn-row center-row">
        <button className="btn btn-ghost btn-sm" onClick={() => setLater(true)}>
          push it further away
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
          delete without opening
        </button>
      </div>

      <Sheet open={later} onClose={() => setLater(false)} title="open it later">
        <p className="muted sheet-body">pick a day after {formatDate(vm.unlockAt!)}. it can only move further away, never closer.</p>
        <label className="field">
          <span className="label">new day</span>
          <input type="date" className="input" min={minDate} max={MAX_UNLOCK_DATE} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </label>
        {newDate && !valid && <p className="error-note">pick a day after {formatDate(vm.unlockAt!)}.</p>}
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setLater(false)}>
            keep the date
          </button>
          <button
            className="btn btn-gold"
            disabled={!valid}
            onClick={async () => {
              await updateVoicemail(vm.id, { unlockAt: newUnlock });
              setLater(false);
              toast(`it now opens ${formatDate(newUnlock!)}.`);
            }}
          >
            move it
          </button>
        </div>
      </Sheet>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="delete it without opening?"
        body="it goes to recently deleted for 30 days, still sealed. after that it's gone for good."
        confirmLabel="delete"
        danger
        onConfirm={async () => {
          await moveToDeleted(vm.id);
          toast('moved to recently deleted.');
          nav('/echoes#future-me', { replace: true });
        }}
      />
    </div>
  );
}

/** The moment a sealed voicemail finally opens: a letter from your past self, opened on purpose. */
export function UnlockReveal({ vm, onOpen }: { vm: Voicemail; onOpen: () => void }) {
  return (
    <div className="unlock-reveal fade-in">
      <div className="reveal-envelope" aria-hidden="true">
        <Icon name="envelope" size={64} />
      </div>
      <p className="eyebrow">from {formatDate(vm.recordedAt)} · {timeAgo(vm.recordedAt)}</p>
      <h1 className="serif reveal-title">you have a voicemail from your past self. ♡</h1>
      <p className="muted">you sealed this {timeAgo(vm.recordedAt)} and asked it to wait until today.</p>
      <button className="btn btn-gold btn-lg" onClick={onOpen}>
        open it
      </button>
    </div>
  );
}
