import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Voicemail } from '../db/types';
import { displayTitle, formatDate, formatDuration, formatShortDate } from '../lib/format';
import { isLocked } from '../db/repo';
import { usePlayer } from '../hooks/usePlayer';
import { player } from '../lib/player';
import { markPlayed } from '../db/repo';
import { Cover } from './Cover';
import { Icon } from './Icon';

export async function playVoicemail(vm: Voicemail) {
  const snap = player.getSnapshot();
  if (snap.voicemailId === vm.id) return player.toggle();
  await player.load(vm);
  await player.play();
  await markPlayed(vm.id);
}

export function PlayButton({ vm, size = 'md' }: { vm: Voicemail; size?: 'sm' | 'md' | 'lg' }) {
  const snap = usePlayer();
  const playing = snap.voicemailId === vm.id && snap.playing;
  return (
    <button
      className={`play-btn play-${size}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        playVoicemail(vm);
      }}
      aria-label={playing ? `pause ${displayTitle(vm)}` : `play ${displayTitle(vm)}`}
    >
      <Icon name={playing ? 'pause' : 'play'} fill="currentColor" strokeWidth={0} size={size === 'lg' ? 30 : size === 'sm' ? 16 : 20} />
    </button>
  );
}

function SealedNote({ vm }: { vm: Voicemail }) {
  return (
    <span className="sealed-note">
      <Icon name="lock" size={14} /> opens {formatDate(vm.unlockAt!)}
    </span>
  );
}

export function VoicemailCard({ vm }: { vm: Voicemail }) {
  const locked = isLocked(vm);
  const title = locked ? 'for future me' : displayTitle(vm);
  const body = (
    <>
      <div className="card-cover-wrap">
        <Cover imageId={vm.coverId} seed={vm.id} title={title} peaks={vm.peaks} locked={locked} />
        {!locked && <PlayButton vm={vm} size="sm" />}
      </div>
      <div className="card-meta">
        <h3 className="card-title">{title}</h3>
        {locked ? (
          <SealedNote vm={vm} />
        ) : (
          <>
            {vm.description && <p className="card-desc">{vm.description}</p>}
            <p className="card-sub">
              {formatShortDate(vm.recordedAt)} · {formatDuration(vm.durationMs)}
              {vm.mood && <span className="mood-dot"> · {vm.mood}</span>}
            </p>
          </>
        )}
      </div>
    </>
  );
  return locked ? (
    <div className="vm-card is-locked" aria-label={`sealed voicemail, opens ${formatDate(vm.unlockAt!)}`}>
      {body}
    </div>
  ) : (
    <Link to={`/voicemail/${vm.id}`} className="vm-card">
      {body}
    </Link>
  );
}

export function VoicemailRow({ vm, right }: { vm: Voicemail; right?: ReactNode }) {
  const locked = isLocked(vm);
  const title = locked ? 'for future me' : displayTitle(vm);
  const inner = (
    <>
      <Cover imageId={vm.coverId} seed={vm.id} title={title} peaks={vm.peaks} size="sm" locked={locked} />
      <div className="row-meta">
        <h3 className="row-title">{title}</h3>
        <p className="row-sub">
          {locked ? (
            <SealedNote vm={vm} />
          ) : (
            <>
              {formatShortDate(vm.recordedAt)} · {formatDuration(vm.durationMs)}
              {vm.mood && ` · ${vm.mood}`}
            </>
          )}
        </p>
      </div>
      {right ?? (!locked && <PlayButton vm={vm} size="sm" />)}
    </>
  );
  return locked ? (
    <div className="vm-row is-locked">{inner}</div>
  ) : (
    <Link to={`/voicemail/${vm.id}`} className="vm-row">
      {inner}
    </Link>
  );
}
