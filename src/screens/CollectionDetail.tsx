import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { addToCollection, deleteCollection, deleteImage, isLocked, moveInCollection, removeFromCollection, saveImage } from '../db/repo';
import type { Voicemail } from '../db/types';
import { Cover } from '../components/Cover';
import { CoverPicker } from '../components/CoverPicker';
import { Icon } from '../components/Icon';
import { Confirm, Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { PlayButton, VoicemailRow } from '../components/VoicemailItem';
import { displayTitle, formatDuration, plural } from '../lib/format';
import { PageHeader } from './parts';

export function CollectionDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const col = useLiveQuery(() => db.collections.get(id), [id]);
  const members = useLiveQuery(async () => {
    const c = await db.collections.get(id);
    if (!c) return [];
    const list = await db.voicemails.bulkGet(c.voicemailIds);
    return list.filter((v): v is Voicemail => !!v);
  }, [id]);
  const allSaved = useLiveQuery(() => db.voicemails.where('status').equals('saved').reverse().sortBy('recordedAt'), []) ?? [];
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  if (col === undefined) return <main className="screen" />;
  if (!col) {
    return (
      <main className="screen">
        <PageHeader title="not here" back />
        <p className="empty">this collection doesn't exist anymore.</p>
      </main>
    );
  }
  const total = (members ?? []).reduce((a, v) => a + v.durationMs, 0);
  const candidates = allSaved.filter((v) => !col.voicemailIds.includes(v.id));

  return (
    <main className="screen collection">
      <PageHeader
        title=""
        back
        right={
          <button
            className="icon-btn"
            aria-label="edit collection"
            onClick={() => {
              setTitle(col.title);
              setDesc(col.description);
              setEditOpen(true);
            }}
          >
            <Icon name="edit" />
          </button>
        }
      />
      <div className="detail-cover">
        <CoverPicker
          imageId={col.coverId}
          label="collection cover"
          onChange={async (blob) => {
            const old = col.coverId;
            await db.collections.update(col.id, { coverId: blob ? await saveImage(blob) : null, updatedAt: Date.now() });
            await deleteImage(old);
          }}
        >
          <Cover imageId={col.coverId} seed={col.id + 'c'} title={col.title} size="lg" />
        </CoverPicker>
      </div>
      <span className="eyebrow center">collection</span>
      <h1 className="detail-title serif">{col.title}</h1>
      <p className="detail-sub">
        {plural(col.voicemailIds.length, 'voicemail')} · {formatDuration(total)}
      </p>
      {col.description && <p className="detail-desc">{col.description}</p>}

      <button className="new-col" onClick={() => setAddOpen(true)}>
        <Icon name="plus" /> add voicemails
      </button>

      <div className="list">
        {members?.map((vm, i) => (
          <div className="reorder-row" key={vm.id}>
            <VoicemailRow
              vm={vm}
              right={
                <span className="row-tools" onClick={(e) => e.preventDefault()}>
                  {!isLocked(vm) && <PlayButton vm={vm} size="sm" />}
                  <button className="icon-btn" aria-label={`move ${displayTitle(vm)} up`} disabled={i === 0} onClick={() => moveInCollection(col.id, i, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`move ${displayTitle(vm)} down`}
                    disabled={i === (members?.length ?? 0) - 1}
                    onClick={() => moveInCollection(col.id, i, 1)}
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button className="icon-btn" aria-label={`remove ${displayTitle(vm)} from collection`} onClick={() => removeFromCollection(col.id, vm.id)}>
                    <Icon name="close" size={16} />
                  </button>
                </span>
              }
            />
          </div>
        ))}
        {members && !members.length && <p className="empty">empty for now. add a few voicemails that belong together.</p>}
      </div>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={`add to ${col.title}`}>
        <div className="menu-list scroll">
          {candidates.map((v) => (
            <button key={v.id} className="menu-item" onClick={() => addToCollection(col.id, v.id)}>
              <Cover imageId={v.coverId} seed={v.id} title={displayTitle(v)} size="sm" locked={isLocked(v)} />
              <span className="grow">{isLocked(v) ? 'for future me' : displayTitle(v)}</span>
              <Icon name="plus" />
            </button>
          ))}
          {!candidates.length && <p className="muted small">every voicemail is already here.</p>}
        </div>
      </Sheet>

      <Sheet open={editOpen} onClose={() => setEditOpen(false)} title="edit collection">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            await db.collections.update(col.id, { title: title.trim() || col.title, description: desc.trim(), updatedAt: Date.now() });
            setEditOpen(false);
          }}
        >
          <label className="field">
            <span className="label">name</span>
            <input className="input input-serif" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </label>
          <label className="field">
            <span className="label">description</span>
            <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
          </label>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setEditOpen(false);
                setConfirmDel(true);
              }}
            >
              delete collection
            </button>
            <button type="submit" className="btn btn-gold">
              save
            </button>
          </div>
        </form>
      </Sheet>

      <Confirm
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="delete this collection?"
        body="only the collection goes. every voicemail inside stays safe in my unspoken."
        confirmLabel="delete collection"
        danger
        onConfirm={async () => {
          await deleteCollection(col.id);
          toast('collection deleted. your voicemails are still here.');
          nav('/library?tab=collections', { replace: true });
        }}
      />
    </main>
  );
}
