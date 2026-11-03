import { useState, type ReactNode } from 'react';
import { MOODS } from '../db/types';
import { useImageUrl } from '../hooks/useImageUrl';
import { formatDate } from '../lib/format';
import { normalizeTag, UNLOCK_LABELS, unlockDate, type UnlockOption } from '../lib/library';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export function MoodPicker({ value, onChange }: { value: string | null; onChange: (m: string | null) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="mood">
      {MOODS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          className={`chip ${value === m ? 'is-on' : ''}`}
          onClick={() => onChange(value === m ? null : m)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ tags, onChange, suggestions = [] }: { tags: string[]; onChange: (t: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);
  return (
    <div>
      <div className="tag-box">
        {tags.map((t) => (
          <span key={t} className="tag">
            #{t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`remove tag ${t}`}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          value={draft}
          placeholder={tags.length ? '' : 'add a tag, press enter'}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          aria-label="tags"
        />
      </div>
      {unused.length > 0 && (
        <div className="chips small-chips">
          {unused.map((s) => (
            <button key={s} type="button" className="chip chip-ghost" onClick={() => add(s)}>
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Seal a voicemail until a future date. */
export function FutureMePicker({ unlockAt, birthday, onChange }: { unlockAt: number | null; birthday: string | null; onChange: (ts: number | null) => void }) {
  const [custom, setCustom] = useState('');
  const options: UnlockOption[] = ['tomorrow', 'week', 'month', 'birthday', 'newyear', 'custom'];
  return (
    <div className="future-me">
      <div className="chips">
        <button type="button" className={`chip ${unlockAt == null ? 'is-on' : ''}`} onClick={() => onChange(null)}>
          keep it open
        </button>
        {options.map((o) =>
          o === 'custom' ? null : (
            <button
              key={o}
              type="button"
              className="chip"
              disabled={o === 'birthday' && !birthday}
              title={o === 'birthday' && !birthday ? 'add your birthday under "you" first' : undefined}
              onClick={() => onChange(unlockDate(o, { birthday }))}
            >
              {UNLOCK_LABELS[o]}
            </button>
          ),
        )}
      </div>
      <label className="field row-field">
        <span className="label">{UNLOCK_LABELS.custom}</span>
        <input
          type="date"
          className="input"
          value={custom}
          min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
          onChange={(e) => {
            setCustom(e.target.value);
            const t = unlockDate('custom', { custom: e.target.value });
            if (t) onChange(t);
          }}
        />
      </label>
      {unlockAt != null && (
        <p className="future-note">
          <Icon name="envelope" size={16} /> sealed until <strong>{formatDate(unlockAt)}</strong>. you won't be able to listen until then.
        </p>
      )}
    </div>
  );
}

function Photo({ id, onOpen }: { id: string; onOpen: () => void }) {
  const url = useImageUrl(id);
  return (
    <button type="button" className="photo-thumb" onClick={onOpen} aria-label="open photo">
      {url && <img src={url} alt="" />}
    </button>
  );
}

function PhotoFull({ id }: { id: string }) {
  const url = useImageUrl(id);
  return url ? <img className="photo-full" src={url} alt="attached photo" /> : null;
}

export function PhotoStrip({ ids, onRemove, adder }: { ids: string[]; onRemove?: (id: string) => void; adder?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="photo-strip">
        {ids.map((id) => (
          <Photo key={id} id={id} onOpen={() => setOpen(id)} />
        ))}
        {adder}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title="a little photo">
        {open && <PhotoFull id={open} />}
        {open && onRemove && (
          <div className="sheet-actions">
            <button
              className="btn btn-danger"
              onClick={() => {
                onRemove(open);
                setOpen(null);
              }}
            >
              remove photo
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
