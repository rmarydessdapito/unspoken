import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { db } from '../db/db';
import { isLocked, setSetting } from '../db/repo';
import type { EchoFrequency, Voicemail } from '../db/types';
import { CollectionPicker } from '../components/CollectionPicker';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { playVoicemail, VoicemailRow } from '../components/VoicemailItem';
import { useToast } from '../components/Toast';
import { useTodaysEcho } from '../hooks/useEcho';
import { useNow } from '../hooks/useNow';
import { displayTitle, formatDate, formatShortDate, plural, timeAgo } from '../lib/format';
import { daysUntilFirstEcho, ECHO_FREQUENCY_LABELS, ECHO_MIN_AGE_DAYS, echoCandidates } from '../lib/library';
import { PageHeader } from './parts';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function Echoes() {
  const now = useNow();
  const toast = useToast();
  const loc = useLocation();
  const savedRaw = useLiveQuery(() => db.voicemails.where('status').equals('saved').toArray(), []);
  const saved = savedRaw ?? [];
  const [colOpen, setColOpen] = useState(false);
  const { echo, due, skippedToday, frequency, nextDay, history, neverEcho, skipToday, neverAgain } = useTodaysEcho(savedRaw, now);

  // arriving from "sealed until…" scrolls straight to the future me shelf
  useEffect(() => {
    if (loc.hash === '#future-me' && savedRaw) document.getElementById('future-me')?.scrollIntoView({ block: 'start' });
  }, [loc.hash, savedRaw]);

  const today = new Date(now);
  const byId = new Map(saved.map((v) => [v.id, v]));
  const onThisDay = saved.filter((v) => {
    const d = new Date(v.recordedAt);
    return !isLocked(v, now) && d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() < today.getFullYear() && v.id !== echo?.id;
  });
  // earlier echoes, newest first, each voicemail once
  const seen = new Set<string>();
  const earlier = history
    .filter((h) => {
      const vm = byId.get(h.id);
      if (!vm || isLocked(vm, now) || seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    })
    .slice(0, 8);
  const sealed = saved.filter((v) => isLocked(v, now)).sort((a, b) => a.unlockAt! - b.unlockAt!);
  const opened = saved.filter((v) => v.unlockAt != null && !isLocked(v, now)).sort((a, b) => b.unlockAt! - a.unlockAt!);
  const candidates = echoCandidates(saved, neverEcho, now).length;
  const waitDays = daysUntilFirstEcho(saved, now);
  const nextText = nextDay ? (nextDay.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() <= 86_400_000 ? 'tomorrow' : `on ${WEEKDAYS[nextDay.getDay()]}`) : '';

  const noEcho = () => {
    if (frequency === 'off')
      return (
        <>
          <p className="serif display-sm">echoes are turned off.</p>
          <p className="muted">nothing will resurface on its own. you can turn them back on whenever you like.</p>
          <button className="btn btn-ochre btn-sm" onClick={() => setSetting('echoFrequency', 'daily')}>
            turn echoes back on
          </button>
        </>
      );
    if (skippedToday)
      return (
        <>
          <p className="serif display-sm">okay. another day.</p>
          <p className="muted">the next echo arrives {nextText || 'soon'}.</p>
        </>
      );
    if (!due)
      return (
        <>
          <p className="serif display-sm">no echo today.</p>
          <p className="muted">echoes arrive {ECHO_FREQUENCY_LABELS[frequency]}. the next one comes {nextText}.</p>
        </>
      );
    if (waitDays == null)
      return (
        <>
          <p className="serif display-sm">no echoes yet.</p>
          <p className="muted">once you've kept a voicemail for a week, it can find its way back to you here.</p>
          <Link to="/record?start=1" className="btn btn-gold btn-sm">
            leave a voicemail
          </Link>
        </>
      );
    if (waitDays > 0)
      return (
        <>
          <p className="serif display-sm">your first echo is on its way.</p>
          <p className="muted">
            voicemails start echoing back once they're {ECHO_MIN_AGE_DAYS} days old. your first one can arrive in {plural(waitDays, 'day')}.
          </p>
        </>
      );
    return (
      <>
        <p className="serif display-sm">nothing to echo right now.</p>
        <p className="muted">every older voicemail is resting or set not to come back.</p>
      </>
    );
  };

  return (
    <main className="screen echoes">
      <PageHeader title="little echoes" eyebrow="voices from earlier versions of you" />

      <label className="sort echo-frequency">
        <span className="muted small">echoes arrive</span>
        <select value={frequency} onChange={(e) => setSetting('echoFrequency', e.target.value as EchoFrequency)} aria-label="how often echoes arrive">
          {(Object.keys(ECHO_FREQUENCY_LABELS) as EchoFrequency[]).map((k) => (
            <option key={k} value={k}>
              {ECHO_FREQUENCY_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      {echo ? (
        <article className="echo-card fade-in">
          <p className="eyebrow">a little echo from {timeAgo(echo.recordedAt, now)}</p>
          <Link to={`/voicemail/${echo.id}`} className="echo-cover" aria-label={`open ${displayTitle(echo)}`}>
            <Cover imageId={echo.coverId} seed={echo.id} title={displayTitle(echo)} peaks={echo.peaks} size="lg" />
          </Link>
          <h2 className="serif echo-title">{displayTitle(echo)}</h2>
          <p className="muted">{formatDate(echo.recordedAt)}</p>
          <div className="echo-actions">
            <button className="btn btn-gold" onClick={() => playVoicemail(echo)}>
              <Icon name="play" fill="currentColor" strokeWidth={0} size={16} /> listen again
            </button>
            <Link to={`/voicemail/${echo.id}`} className="btn btn-ghost">
              open it
            </Link>
            <button className="btn btn-ochre" onClick={() => setColOpen(true)}>
              keep in a collection
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await skipToday();
                toast('okay. another day.');
              }}
            >
              not today
            </button>
          </div>
          <button
            className="link small echo-never"
            onClick={async () => {
              await neverAgain(echo.id);
              toast("it won't echo back again. it's still in my unspoken.");
            }}
          >
            don't bring this one back
          </button>
          <CollectionPicker voicemailId={echo.id} open={colOpen} onClose={() => setColOpen(false)} />
        </article>
      ) : (
        savedRaw && <div className="empty-big echo-empty">{noEcho()}</div>
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

      {earlier.length > 0 && (
        <section className="section">
          <h2 className="section-title serif">earlier echoes</h2>
          <div className="list">
            {earlier.map((h) => (
              <div key={h.id} className="echo-history-row">
                <span className="eyebrow">echoed {formatShortDate(new Date(h.date + 'T12:00').getTime())}</span>
                <VoicemailRow vm={byId.get(h.id) as Voicemail} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section" id="future-me">
        <h2 className="section-title serif">future me</h2>
        <p className="muted small">voicemails you sealed for later. each one opens on its own when its day comes.</p>
        {sealed.length ? (
          <div className="list">
            {sealed.map((v) => (
              <VoicemailRow key={v.id} vm={v} />
            ))}
          </div>
        ) : (
          <p className="empty">nothing sealed. when you save a voicemail, choose “send it to future me?” to keep it closed until a day you pick.</p>
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

      {neverEcho.length > 0 && (
        <p className="small muted echo-footnote">
          {plural(neverEcho.filter((id) => byId.has(id)).length, 'voicemail')} set not to echo back ·{' '}
          <button className="link" onClick={() => setSetting('neverEcho', [])}>
            let them echo again
          </button>
        </p>
      )}
      {candidates > 0 && frequency !== 'off' && <p className="fine center">echoes come from voicemails at least {ECHO_MIN_AGE_DAYS} days old, and each one rests for two months after it echoes.</p>}
    </main>
  );
}
