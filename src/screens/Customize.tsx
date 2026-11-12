import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { deleteImage, isLocked, moveToDeleted, saveImage, updateVoicemail } from '../db/repo';
import type { Voicemail } from '../db/types';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { CoverPicker, PhotoAdder } from '../components/CoverPicker';
import { FutureMePicker, MoodPicker, PhotoStrip, TagInput } from '../components/Fields';
import { Confirm, Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks/useSettings';
import { defaultTitle, formatDate, formatDuration, formatTime, fromDateTimeInputs, toDateInput, toTimeInput, untilText } from '../lib/format';
import { allTags } from '../lib/library';
import { PageHeader } from './parts';

const TITLE_IDEAS = ['things i never said', 'a random tuesday', 'thoughts at 2am', 'future me, listen to this', 'a day worth remembering'];

export function Customize() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const isNew = params.get('new') === '1';
  const nav = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const vm = useLiveQuery(() => db.voicemails.get(id), [id]);
  const tagPool = useLiveQuery(async () => allTags(await db.voicemails.where('status').equals('saved').toArray()), []) ?? [];

  const [form, setForm] = useState<Voicemail | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const justSealed = useRef(false);
  const [sealOpen, setSealOpen] = useState(false);

  useEffect(() => {
    if (vm && !form) {
      setForm(vm);
      setDate(toDateInput(vm.recordedAt));
      setTime(toTimeInput(vm.recordedAt));
    }
  }, [vm, form]);

  if (vm === undefined && form === null) return <main className="screen" />;
  if (!vm || !form || vm.status === 'deleted') {
    return (
      <main className="screen">
        <PageHeader title="not here" back />
        <p className="empty">this voicemail doesn't exist anymore.</p>
      </main>
    );
  }
  // a sealed voicemail can't be read or edited until it opens (justSealed: we're the ones who just sealed it)
  if (isLocked(vm) && !justSealed.current) {
    return (
      <main className="screen">
        <PageHeader title="for future me" back />
        <p className="empty">this one's sealed. its details stay hidden until it opens.</p>
      </main>
    );
  }

  const set = <K extends keyof Voicemail>(k: K, v: Voicemail[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async (sealConfirmed = false) => {
    const sealing = form.unlockAt != null && form.unlockAt > Date.now() && form.unlockAt !== vm.unlockAt;
    if (sealing && !sealConfirmed) {
      setSealOpen(true);
      return;
    }
    setSaving(true);
    if (sealing) justSealed.current = true;
    try {
      await updateVoicemail(vm.id, {
        title: form.title.trim().slice(0, 120),
        description: form.description.trim().slice(0, 2000),
        mood: form.mood,
        tags: form.tags,
        transcript: form.transcript,
        unlockAt: form.unlockAt,
        unlockSeen: form.unlockAt == null ? vm.unlockSeen : false,
        recordedAt: fromDateTimeInputs(date, time) ?? vm.recordedAt,
        status: 'saved',
      });
      if (sealing) {
        toast(`sealed until ${formatDate(form.unlockAt!)}. future you will find it there.`);
        nav('/echoes#future-me', { replace: true });
      } else {
        toast(isNew ? 'voicemail saved. this thought has somewhere to go now.' : 'saved.');
        nav(`/voicemail/${vm.id}`, { replace: true });
      }
    } finally {
      setSaving(false);
    }
  };

  // images save immediately — they're heavy and shouldn't wait on the form
  const setCover = async (blob: Blob | null) => {
    const old = vm.coverId;
    const coverId = blob ? await saveImage(blob) : null;
    await updateVoicemail(vm.id, { coverId });
    await deleteImage(old);
  };
  const addPhotos = async (blobs: Blob[]) => {
    const ids = await Promise.all(blobs.map(saveImage));
    const fresh = await db.voicemails.get(vm.id);
    await updateVoicemail(vm.id, { photoIds: [...(fresh?.photoIds ?? []), ...ids] });
  };
  const removePhoto = async (pid: string) => {
    await updateVoicemail(vm.id, { photoIds: vm.photoIds.filter((p) => p !== pid) });
    await deleteImage(pid);
  };

  return (
    <main className="screen customize">
      {isNew ? (
        <header className="customize-head fade-in">
          <h1 className="serif display">you got it out.</h1>
          <p className="tagline">somewhere for this little piece of you.</p>
        </header>
      ) : (
        <PageHeader title="edit details" back />
      )}

      {/* on wide screens: cover on the left, the form on the right */}
      <div className="split">
        <div className="split-aside">
          <div className="customize-cover">
            <CoverPicker imageId={vm.coverId} onChange={setCover}>
              <Cover imageId={vm.coverId} seed={vm.id} title={form.title || defaultTitle(vm.recordedAt)} peaks={vm.peaks} size="lg" />
            </CoverPicker>
            <p className="muted small center">{formatDuration(vm.durationMs)} · artwork is optional</p>
          </div>
        </div>

        <form
          className="form split-main"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            <span className="label">title</span>
            <input
              className="input input-serif"
              value={form.title}
              placeholder={defaultTitle(vm.recordedAt)}
              onChange={(e) => set('title', e.target.value)}
              maxLength={120}
              name="title"
            />
          </label>
          {!form.title && (
            <div className="chips small-chips">
              {TITLE_IDEAS.map((t) => (
                <button key={t} type="button" className="chip chip-ghost" onClick={() => set('title', t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <label className="field">
            <span className="label">a little context</span>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              placeholder="recording this because i don't want to forget how i felt."
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
              name="description"
            />
          </label>

          <div className="field">
            <span className="label">how are you feeling?</span>
            <MoodPicker value={form.mood} onChange={(m) => set('mood', m)} />
          </div>

          <div className="field">
            <span className="label">tags</span>
            <TagInput tags={form.tags} onChange={(t) => set('tags', t)} suggestions={tagPool} />
          </div>

          <div className="field-row">
            <label className="field">
              <span className="label">recorded on</span>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">at</span>
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span className="label">more photos</span>
            <PhotoStrip ids={vm.photoIds} onRemove={removePhoto} adder={<PhotoAdder onAdd={addPhotos} />} />
          </div>

          {(form.transcript || vm.transcript) && (
            <label className="field">
              <span className="label">transcript</span>
              <textarea className="input" rows={4} value={form.transcript} onChange={(e) => set('transcript', e.target.value)} />
            </label>
          )}

          <div className="field">
            <span className="label">send it to future me?</span>
            <FutureMePicker unlockAt={form.unlockAt} birthday={settings.birthday} onChange={(t) => set('unlockAt', t)} />
          </div>

          <div className="form-actions">
            {isNew && (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDiscard(true)}>
                discard
              </button>
            )}
            <button type="submit" className="btn btn-gold btn-lg" disabled={saving}>
              {isNew ? 'keep it' : 'save changes'}
            </button>
          </div>
          {isNew && <p className="muted small center">every field is optional. you can always change these later.</p>}
        </form>
      </div>

      <Sheet open={sealOpen} onClose={() => setSealOpen(false)} title="seal it for future you?">
        {form.unlockAt && (
          <>
            <div className="seal-preview">
              <Icon name="envelope" size={40} />
              <p className="serif seal-date">{formatDate(form.unlockAt)}</p>
              <p className="muted small">
                {formatTime(form.unlockAt)} · {untilText(form.unlockAt)}
              </p>
            </div>
            <p className="muted sheet-body">
              once it's sealed, you won't be able to listen to it, read its title or change its details until then. you can still push the date further
              away, or delete it without opening it.
            </p>
          </>
        )}
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setSealOpen(false)}>
            not yet
          </button>
          <button
            className="btn btn-gold"
            onClick={() => {
              setSealOpen(false);
              save(true);
            }}
          >
            seal it
          </button>
        </div>
      </Sheet>

      <Confirm
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="let this one go?"
        body="it moves to recently deleted, where you can still restore it for 30 days."
        confirmLabel="let it go"
        danger
        onConfirm={async () => {
          await moveToDeleted(vm.id);
          toast('moved to recently deleted.');
          nav('/', { replace: true });
        }}
      />
    </main>
  );
}
