import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { isLocked } from '../db/repo';
import { Cover } from '../components/Cover';
import { CollectionCover } from '../components/CollectionCover';
import { Icon } from '../components/Icon';
import { VoicemailCard } from '../components/VoicemailItem';
import { useNow } from '../hooks/useNow';
import { useTodaysEcho } from '../hooks/useEcho';
import { useSettings } from '../hooks/useSettings';
import { displayTitle, formatDate, formatDuration, greeting, plural, timeAgo } from '../lib/format';
import { DraftRow } from './Drafts';

export function Home() {
  const now = useNow();
  const nav = useNavigate();
  const settings = useSettings();
  const savedRaw = useLiveQuery(() => db.voicemails.where('status').equals('saved').toArray(), []);
  const saved = savedRaw ?? [];
  const drafts = useLiveQuery(() => db.voicemails.where('status').equals('draft').reverse().sortBy('updatedAt'), []) ?? [];
  const collections = useLiveQuery(() => db.collections.orderBy('updatedAt').reverse().toArray(), []) ?? [];

  const recent = [...saved].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const { echo } = useTodaysEcho(savedRaw, now);
  const sealed = saved.filter((v) => isLocked(v, now));
  const fresh = saved.filter((v) => v.unlockAt != null && !isLocked(v, now) && !v.unlockSeen);

  return (
    <main className="screen home">
      <header className="home-head fade-in">
        <p className="wordmark">unspoken</p>
        <p className="tagline">for everything left unsaid.</p>
      </header>

      <p className="greeting serif fade-in">
        {greeting(new Date(now), settings.name)}
      </p>

      <button className="record-hero fade-in" onClick={() => nav('/record?start=1')}>
        <span className="record-hero-btn" aria-hidden="true">
          <span className="breath" />
          <Icon name="mic" size={34} />
        </span>
        <span className="record-hero-text">
          <span className="record-hero-title serif">leave a voicemail</span>
          <span className="record-hero-sub">say whatever's on your mind.</span>
        </span>
      </button>

      {fresh.map((vm) => (
        <Link key={vm.id} to={`/voicemail/${vm.id}`} className="unlock-banner fade-in">
          <Icon name="envelope" />
          <span>
            <strong>you have a voicemail from your past self. ♡</strong>
            <span className="small">recorded {formatDate(vm.recordedAt)}</span>
          </span>
        </Link>
      ))}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title serif">recently saved</h2>
          {saved.length > 0 && (
            <Link to="/library" className="link small">
              see all
            </Link>
          )}
        </div>
        {recent.length ? (
          <div className="shelf">
            {recent.map((vm) => (
              <VoicemailCard key={vm.id} vm={vm} />
            ))}
          </div>
        ) : (
          <p className="empty">nothing here yet. your first voicemail will live here.</p>
        )}
      </section>

      {echo && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title serif">little echoes</h2>
            <Link to="/echoes" className="link small">
              more
            </Link>
          </div>
          <Link to={`/voicemail/${echo.id}`} className="echo-mini">
            <Cover imageId={echo.coverId} seed={echo.id} title={displayTitle(echo)} peaks={echo.peaks} size="sm" />
            <span>
              <span className="eyebrow">a little echo from {timeAgo(echo.recordedAt, now)}</span>
              <span className="echo-mini-title serif">{displayTitle(echo)}</span>
            </span>
          </Link>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title serif">unfinished thoughts</h2>
            <Link to="/drafts" className="link small">
              {drafts.length} saved
            </Link>
          </div>
          <div className="list">
            {drafts.slice(0, 3).map((d) => (
              <DraftRow key={d.id} vm={d} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title serif">your collections</h2>
          <Link to="/library?tab=collections" className="link small">
            {collections.length ? 'all' : 'start one'}
          </Link>
        </div>
        {collections.length ? (
          <div className="shelf">
            {collections.slice(0, 6).map((c) => (
              <Link key={c.id} to={`/collection/${c.id}`} className="col-card">
                <CollectionCover collection={c} />
                <span className="card-title">{c.title}</span>
                <span className="card-sub">{plural(c.voicemailIds.length, 'voicemail')}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty">gather voicemails into little collections — people i love, late night thoughts…</p>
        )}
      </section>

      {sealed.length > 0 && (
        <p className="sealed-summary small muted">
          <Icon name="lock" size={14} /> {sealed.length} voicemail{sealed.length > 1 ? 's' : ''} waiting for future you ·{' '}
          {formatDuration(sealed.reduce((a, v) => a + v.durationMs, 0))}
        </p>
      )}
    </main>
  );
}
