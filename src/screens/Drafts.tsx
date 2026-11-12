import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { moveToDeleted, updateVoicemail } from '../db/repo';
import type { Voicemail } from '../db/types';
import { Icon } from '../components/Icon';
import { Confirm } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { PageHeader } from './parts';
import { defaultTitle, formatDuration, timeAgo } from '../lib/format';

export function DraftRow({ vm }: { vm: Voicemail }) {
  const nav = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="draft-row">
      <span className="draft-icon" aria-hidden="true">
        <Icon name="draft" />
      </span>
      <div className="row-meta">
        <h3 className="row-title">{vm.prompt ?? defaultTitle(vm.createdAt)}</h3>
        <p className="row-sub">
          {formatDuration(vm.durationMs)} so far · {timeAgo(vm.updatedAt)}
        </p>
      </div>
      <div className="draft-actions">
        <button className="btn btn-sm btn-ochre" onClick={() => nav(`/record?draft=${vm.id}`)} aria-label="continue recording">
          continue
        </button>
        <button
          className="icon-btn"
          aria-label="finish as it is"
          title="save as it is"
          onClick={async () => {
            await updateVoicemail(vm.id, { status: 'saved' });
            nav(`/voicemail/${vm.id}/customize?new=1`);
          }}
        >
          <Icon name="check" />
        </button>
        <button className="icon-btn" aria-label="delete draft" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={18} />
        </button>
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="let this one go?"
        body="it moves to recently deleted, where you can restore it for 30 days."
        confirmLabel="delete"
        danger
        onConfirm={async () => {
          await moveToDeleted(vm.id);
          toast('moved to recently deleted.');
        }}
      />
    </div>
  );
}

export function Drafts() {
  const drafts = useLiveQuery(() => db.voicemails.where('status').equals('draft').reverse().sortBy('updatedAt'), []);
  return (
    <main className="screen">
      <PageHeader title="unfinished thoughts" back />
      <p className="muted">paused somewhere in the middle. pick up right where you stopped.</p>
      <div className="list">
        {drafts?.map((d) => (
          <DraftRow key={d.id} vm={d} />
        ))}
        {drafts && !drafts.length && <p className="empty">no unfinished thoughts. everything's been said, for now.</p>}
      </div>
    </main>
  );
}
