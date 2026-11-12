import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useLocation } from 'react-router-dom';
import { db } from '../db/db';
import { usePlayer } from '../hooks/usePlayer';
import { displayTitle, formatDuration } from '../lib/format';
import { player } from '../lib/player';
import { Cover } from './Cover';
import { Icon } from './Icon';

/** Small player that follows you around the app while a voicemail is playing. */
export function MiniPlayer() {
  const snap = usePlayer();
  const loc = useLocation();
  const vm = useLiveQuery(() => (snap.voicemailId ? db.voicemails.get(snap.voicemailId) : undefined), [snap.voicemailId]);
  if (!vm || loc.pathname === `/voicemail/${vm.id}` || loc.pathname.startsWith('/record')) return null;
  const progress = snap.durationMs ? snap.positionMs / snap.durationMs : 0;
  return (
    <div className="mini-player">
      <div className="mini-progress" style={{ width: `${progress * 100}%` }} />
      <Link to={`/voicemail/${vm.id}`} className="mini-main">
        <Cover imageId={vm.coverId} seed={vm.id} title={displayTitle(vm)} peaks={vm.peaks} size="sm" />
        <div className="mini-text">
          <span className="mini-title">{displayTitle(vm)}</span>
          <span className="mini-sub">
            {formatDuration(snap.positionMs)} / {formatDuration(snap.durationMs)}
            {snap.queueLength > 1 && ` · ${snap.queueIndex + 1} of ${snap.queueLength}`}
          </span>
        </div>
      </Link>
      <button className="icon-btn" onClick={() => player.toggle()} aria-label={snap.playing ? 'pause' : 'play'}>
        <Icon name={snap.playing ? 'pause' : 'play'} fill="currentColor" strokeWidth={0} />
      </button>
      {snap.queueLength > 1 && snap.queueIndex < snap.queueLength - 1 && (
        <button className="icon-btn" onClick={() => player.next()} aria-label="next voicemail">
          <Icon name="next" size={20} />
        </button>
      )}
      <button className="icon-btn" onClick={() => player.unload()} aria-label="close player">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
