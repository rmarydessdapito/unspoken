import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import { deleteVoicemail, isLocked, restoreDeleted } from '../db/repo';
import { DELETED_KEEP_DAYS, type Voicemail } from '../db/types';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Confirm } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { displayTitle, formatDuration, plural, timeAgo } from '../lib/format';
import { PageHeader } from './parts';

function daysLeft(vm: Voicemail, now = Date.now()) {
  const gone = (vm.deletedAt ?? now) + DELETED_KEEP_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((gone - now) / 86_400_000));
}

export function Deleted() {
  const toast = useToast();
  const items = useLiveQuery(() => db.voicemails.where('status').equals('deleted').toArray(), []);
  const [forever, setForever] = useState<Voicemail | null>(null);
  const [emptyAll, setEmptyAll] = useState(false);
  const sorted = [...(items ?? [])].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  return (
    <main className="screen">
      <PageHeader title="recently deleted" back eyebrow={`kept for ${DELETED_KEEP_DAYS} days, then erased for good`} />
      {items && !items.length && <p className="empty">nothing here. anything you delete waits here for {DELETED_KEEP_DAYS} days, in case you change your mind.</p>}
      <div className="list">
        {sorted.map((vm) => {
          const sealed = isLocked(vm);
          const title = sealed ? 'for future me' : displayTitle(vm);
          return (
            <div key={vm.id} className="vm-row deleted-row">
              <Cover imageId={vm.coverId} seed={vm.id} title={title} peaks={vm.peaks} size="sm" locked={sealed} />
              <div className="row-meta">
                <h3 className="row-title">{title}</h3>
                <p className="row-sub">
                  {vm.deletedFrom === 'draft' ? 'unfinished · ' : ''}
                  {sealed ? 'still sealed' : formatDuration(vm.durationMs)} · deleted {timeAgo(vm.deletedAt ?? Date.now())} · gone in{' '}
                  {plural(daysLeft(vm), 'day')}
                </p>
              </div>
              <button
                className="btn btn-sm btn-ochre"
                onClick={async () => {
                  await restoreDeleted(vm.id);
                  toast(vm.deletedFrom === 'draft' ? 'restored to unfinished thoughts.' : 'restored.');
                }}
              >
                restore
              </button>
              <button className="icon-btn" aria-label={`delete ${title} forever`} onClick={() => setForever(vm)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          );
        })}
      </div>
      {sorted.length > 1 && (
        <button className="btn btn-danger btn-sm empty-bin" onClick={() => setEmptyAll(true)}>
          delete all {sorted.length} forever
        </button>
      )}

      <Confirm
        open={!!forever}
        onClose={() => setForever(null)}
        title="delete forever?"
        body="the audio, artwork and photos will be erased right now. this can't be undone."
        confirmLabel="delete forever"
        danger
        onConfirm={async () => {
          if (forever) await deleteVoicemail(forever.id);
          toast('erased.');
        }}
      />
      <Confirm
        open={emptyAll}
        onClose={() => setEmptyAll(false)}
        title={`erase all ${sorted.length}?`}
        body="everything in recently deleted will be erased right now. this can't be undone."
        confirmLabel="erase all"
        danger
        onConfirm={async () => {
          for (const vm of sorted) await deleteVoicemail(vm.id);
          toast('erased.');
        }}
      />
    </main>
  );
}
