import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { isLocked, setSetting } from '../db/repo';
import { CollectionPicker } from '../components/CollectionPicker';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { playVoicemail, VoicemailRow } from '../components/VoicemailItem';
import { useToast } from '../components/Toast';
import { useNow } from '../hooks/useNow';
import { useSettings } from '../hooks/useSettings';
import { displayTitle, formatDate, timeAgo, todayKey } from '../lib/format';
import { pickEcho } from '../lib/library';
import { PageHeader } from './parts';

export function Echoes() {
  const now = useNow();
  const settings = useSettings();
  const toast = useToast();
  const saved = useLiveQuery(() => db.voicemails.where('status').equals('saved').toArray(), []) ?? [];
  const [colOpen, setColOpen] = useState(false);

  const echo = pickEcho(saved, settings.dismissedEchoes, now);
  const today = new Date(now);
  const onThisDay = saved.filter((v) => {
    const d = new Date(v.recordedAt);
    return (
      !isLocked(v, now) && d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() < today.getFullYear() && v.id !== echo?.id
    );
  });
  const sealed = saved.filter((v) => isLocked(v, now)).sort((a, b) => a.unlockAt! - b.unlockAt!);
  const opened = saved.filter((v) => v.unlockAt != null && !isLocked(v, now)).sort((a, b) => b.unlockAt! - a.unlockAt!);

  return (
    <main className="screen echoes">
      <PageHeader title="little echoes" eyebrow="voices from earlier versions of you" />

      {echo ? (
        <article className="echo-card fade-in">
          <p className="eyebrow">a little echo from {timeAgo(echo.recordedAt, now)}</p>
          <Link to={`/voicemail/${echo.id}`} className="echo-cover">
            <Cover imageId={echo.coverId} seed={echo.id} title={displayTitle(echo)} peaks={echo.peaks} size="lg" />
          </Link>
          <h2 className="serif echo-title">{displayTitle(echo)}</h2>
          <p className="muted">{formatDate(echo.recordedAt)}</p>
          <div className="echo-actions">
            <button className="btn btn-gold" onClick={() => playVoicemail(echo)}>
              <Icon name="play" fill="currentColor" strokeWidth={0} size={16} /> listen again
            </button>
            <button className="btn btn-ochre" onClick={() => setColOpen(true)}>
              keep in a collection
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await setSetting('dismissedEchoes', { ...settings.dismissedEchoes, [echo.id]: todayKey() });
                toast('okay. another day.');
              }}
            >
              not today
            </button>
          </div>
          <CollectionPicker voicemailId={echo.id} open={colOpen} onClose={() => setColOpen(false)} />
        </article>
      ) : (
        <div className="empty-big">
          <p className="serif display-sm">no echoes yet.</p>
          <p className="muted">once your voicemails are a little older, they'll start finding their way back to you here.</p>
        </div>
      )}

      {onThisDay.length > 0 && (
        <section className="section">
          <h2 className="section-title serif">on this day</h2>
          <div className="list">
            {onThisDay.map((v) => (
              <VoicemailRow key={v.id} vm={v} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title serif">future me</h2>
        <p className="muted small">voicemails you sealed for later. they open on their own when it's time.</p>
        {sealed.length ? (
          <div className="list">
            {sealed.map((v) => (
              <VoicemailRow key={v.id} vm={v} />
            ))}
          </div>
        ) : (
          <p className="empty">nothing sealed. when you save a voicemail, choose “send it to future me” to keep it closed until a day you pick.</p>
        )}
        {opened.length > 0 && (
          <>
            <h3 className="eyebrow sub-eyebrow">already opened</h3>
            <div className="list">
              {opened.map((v) => (
                <VoicemailRow key={v.id} vm={v} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
