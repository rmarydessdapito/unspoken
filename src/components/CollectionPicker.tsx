import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import { addToCollection, createCollection, removeFromCollection } from '../db/repo';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

/** Toggle a voicemail in and out of collections, or start a new one. */
export function CollectionPicker({ voicemailId, open, onClose }: { voicemailId: string; open: boolean; onClose: () => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [name, setName] = useState('');
  const toast = useToast();
  return (
    <Sheet open={open} onClose={onClose} title="add to a collection">
      <div className="menu-list">
        {collections.map((c) => {
          const inside = c.voicemailIds.includes(voicemailId);
          return (
            <button
              key={c.id}
              className={`menu-item ${inside ? 'is-on' : ''}`}
              aria-pressed={inside}
              onClick={async () => {
                if (inside) await removeFromCollection(c.id, voicemailId);
                else {
                  await addToCollection(c.id, voicemailId);
                  toast(`kept in ${c.title}.`);
                }
              }}
            >
              <Icon name={inside ? 'check' : 'folder'} /> {c.title}
              <span className="muted small push">{c.voicemailIds.length}</span>
            </button>
          );
        })}
        {!collections.length && <p className="muted small">no collections yet. start one below.</p>}
      </div>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = await createCollection(name);
          await addToCollection(id, voicemailId);
          toast(`kept in ${name.trim()}.`);
          setName('');
        }}
      >
        <input className="input" placeholder="a new collection… (late night thoughts)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn btn-gold" type="submit" disabled={!name.trim()}>
          create
        </button>
      </form>
    </Sheet>
  );
}
