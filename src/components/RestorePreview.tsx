import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { formatDate } from '../lib/format';
import { analyzeBackup, previewRestore, restoreBackup, type BackupProgress, type RestoreOptions, type RestorePlan, type RestoreSummary } from '../lib/backup';

function Choice({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
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

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Shows what restoring a backup would do — before anything changes — and lets the person choose.
 * By default nothing on this device is deleted or replaced.
 */
export function RestorePreview({ file, onClose, onDone }: { file: File | null; onClose: () => void; onDone: (summary: RestoreSummary | null) => void }) {
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [options, setOptions] = useState<RestoreOptions | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [working, setWorking] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const seq = useRef(0);

  // read and check the backup as soon as a file is chosen; this changes nothing
  useEffect(() => {
    setPlan(null);
    setOptions(null);
    setSummary(null);
    setError(null);
    setUnderstood(false);
    if (!file) return;
    let live = true;
    analyzeBackup(file, setProgress)
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setOptions(p.defaults);
        setSummary(p.summary);
        setProgress(null);
      })
      .catch((e: Error) => live && (setError(e.message || "i couldn't read that backup. nothing was changed."), setProgress(null)));
    return () => {
      live = false;
    };
  }, [file]);

  // keep the numbers in step with the choices
  useEffect(() => {
    if (!plan || !options) return;
    const mine = ++seq.current;
    previewRestore(plan, options).then((s) => mine === seq.current && setSummary(s));
  }, [plan, options]);

  const set = (patch: Partial<RestoreOptions>) => {
    setUnderstood(false);
    setOptions((o) => (o ? { ...o, ...patch } : o));
  };

  const replaces = !!options && (options.useBackupDetails || options.includeErased || (options.restoreSettings && !plan?.freshDevice));
  const nothing = !!summary && !summary.added && !summary.recovered && !summary.replaced && !summary.collectionsAdded && !summary.collectionMembersAdded && !summary.settingsToRestore;

  const run = async () => {
    if (!file || !plan || !options) return;
    setWorking(true);
    setError(null);
    try {
      const r = await restoreBackup(file, plan, options, setProgress);
      onDone(r.summary);
    } catch (e) {
      setError((e as Error).message || "that backup couldn't be restored. nothing was changed.");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  const s = summary;
  return (
    <Sheet open={!!file} onClose={() => !working && onClose()} title="restore this backup?">
      {!plan && !error && (
        <p className="muted sheet-body" role="status">
          {progress ? `${progress.label}…` : 'opening your backup…'}
        </p>
      )}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      {plan && options && s && (
        <div className="restore-preview">
          <p className="muted sheet-body">
            made {formatDate(plan.exportedAt)}. nothing on this device is deleted or replaced unless you choose it below.
          </p>
          <ul className="restore-list" aria-label="what will happen">
            {s.added > 0 && (
              <li>
                <strong>added:</strong> {n(s.added, 'voicemail')}
              </li>
            )}
            {s.recovered > 0 && (
              <li>
                <strong>recovered:</strong> missing audio or photos for {n(s.recovered, 'voicemail')}
              </li>
            )}
            {s.replaced > 0 && (
              <li>
                <strong>replaced:</strong> the details of {n(s.replaced, 'voicemail')}
              </li>
            )}
            {s.retained > 0 && (
              <li>
                <strong>kept as they are:</strong> {n(s.retained, 'voicemail')} already here
              </li>
            )}
            {(s.collectionsAdded > 0 || s.collectionMembersAdded > 0) && (
              <li>
                <strong>collections:</strong> {s.collectionsAdded > 0 ? `${n(s.collectionsAdded, 'new collection')}, ` : ''}
                {n(s.collectionMembersAdded, 'voicemail')} added to collections. nothing is taken out.
              </li>
            )}
            {s.settingsToRestore > 0 && (
              <li>
                <strong>preferences:</strong> {n(s.settingsToRestore, 'setting')} restored
              </li>
            )}
            {nothing && <li>everything in this backup is already here. nothing will change.</li>}
          </ul>
          {(s.skipped.trashedHere > 0 || s.skipped.trashedInBackup > 0 || s.skipped.erased > 0 || s.skipped.notOnThisDevice > 0 || s.skipped.noAudio > 0) && (
            <p className="fine">
              not restored:{' '}
              {[
                s.skipped.trashedHere && `${s.skipped.trashedHere} in recently deleted here (they stay there)`,
                s.skipped.trashedInBackup && `${s.skipped.trashedInBackup} that were in recently deleted in the backup`,
                s.skipped.erased && `${s.skipped.erased} you erased for good`,
                s.skipped.notOnThisDevice && `${s.skipped.notOnThisDevice} not on this device`,
                s.skipped.noAudio && `${s.skipped.noAudio} with no audio in the backup`,
              ]
                .filter(Boolean)
                .join(', ')}
              .
            </p>
          )}

          {(plan.available.missing > 0 || plan.available.erased > 0 || plan.available.newer > 0 || plan.available.settings > 0) && (
            <div className="restore-choices">
              {plan.available.missing > 0 && (
                <Choice
                  checked={options.includeMissing}
                  onChange={(v) => set({ includeMissing: v })}
                  label={`add the ${n(plan.available.missing, 'voicemail')} this device doesn't have`}
                  hint={plan.freshDevice ? 'this device is empty, so everything comes back.' : "off by default: i can't tell whether you removed them on purpose."}
                  disabled={working}
                />
              )}
              {plan.available.erased > 0 && (
                <Choice
                  checked={options.includeErased}
                  onChange={(v) => set({ includeErased: v })}
                  label={`also bring back ${n(plan.available.erased, 'voicemail')} you erased for good`}
                  hint="off by default. they'll be back in my unspoken."
                  disabled={working}
                />
              )}
              {plan.available.newer > 0 && (
                <Choice
                  checked={options.useBackupDetails}
                  onChange={(v) => set({ useBackupDetails: v })}
                  label={`use the backup's details for ${n(plan.available.newer, 'voicemail')} edited more recently there`}
                  hint="titles, notes, mood, tags and transcripts only. audio and photos here are never replaced."
                  disabled={working}
                />
              )}
              {plan.available.settings > 0 && (
                <Choice
                  checked={options.restoreSettings}
                  onChange={(v) => set({ restoreSettings: v })}
                  label={`restore my preferences (${plan.available.settings} differ)`}
                  hint="your passcode and lock settings are never restored."
                  disabled={working}
                />
              )}
            </div>
          )}

          {replaces && !plan.freshDevice && (
            <label className="toggle-row">
              <span className="toggle-label">i understand this replaces some of what's on this device</span>
              <input type="checkbox" className="toggle" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} disabled={working} />
            </label>
          )}
          {working && progress && (
            <div className="progress" role="progressbar" aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}>
              <div className="meter">
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <p className="small muted">{progress.label}… please keep this open.</p>
            </div>
          )}
        </div>
      )}
      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={working}>
          {error || nothing ? 'close' : 'never mind'}
        </button>
        {plan && !error && !nothing && (
          <button className="btn btn-gold" onClick={run} disabled={working || (replaces && !plan.freshDevice && !understood)}>
            {working ? 'restoring…' : 'restore'}
          </button>
        )}
      </div>
    </Sheet>
  );
}
