import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSetting } from '../db/repo';

const SLIDES = [
  { line: 'some thoughts are easier to say than to write.' },
  { line: "so don't write them." },
  { line: 'just talk.' },
  { line: 'welcome to unspoken.', sub: 'for everything left unsaid.' },
];

export function Onboarding() {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const last = i === SLIDES.length - 1;
  const finish = async (to: string) => {
    await setSetting('onboarded', true);
    nav(to, { replace: true, state: { fromOnboarding: true } });
  };
  return (
    <main className="onboarding" onClick={() => !last && setI(i + 1)}>
      <button className="skip link" onClick={(e) => (e.stopPropagation(), finish('/'))}>
        skip
      </button>
      <div className="onboarding-slide fade-in" key={i}>
        {last && <p className="wordmark onboarding-mark">unspoken</p>}
        <h1 className="serif onboarding-line">{SLIDES[i].line}</h1>
        {SLIDES[i].sub && <p className="tagline">{SLIDES[i].sub}</p>}
      </div>
      <div className="onboarding-foot">
        <div className="dots" aria-hidden="true">
          {SLIDES.map((_, k) => (
            <span key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        {last ? (
          <button className="btn btn-gold btn-lg" onClick={(e) => (e.stopPropagation(), finish('/record?start=1'))}>
            leave your first voicemail →
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={(e) => (e.stopPropagation(), setI(i + 1))}>
            continue
          </button>
        )}
      </div>
    </main>
  );
}
