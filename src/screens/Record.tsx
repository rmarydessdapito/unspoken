import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { moveToDeleted, updateVoicemail } from '../db/repo';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { LiveWaveform } from '../components/Waveform';
import { useSettings } from '../hooks/useSettings';
import { formatBytes, formatDuration } from '../lib/format';
import { readStorageStatus, type StorageStatus } from '../lib/nudges';
import { player } from '../lib/player';
import { pickPrompts } from '../lib/prompts';
import { describeMicError, micPermission, recordingSupported, VoicemailRecorder, type RecorderState } from '../lib/recorder';
import { haptic, playBeep, playClick } from '../lib/sounds';
import { LiveTranscriber, transcriptionSupported } from '../lib/transcription';

type WakeLockSentinelLike = { release(): Promise<void> };

export function Record() {
  const [params] = useSearchParams();
  const draftId = params.get('draft');
  const autoStart = params.get('start') === '1';
  const nav = useNavigate();
  const toast = useToast();
  const settings = useSettings();

  const recRef = useRef<VoicemailRecorder | null>(null);
  const transcriber = useRef<LiveTranscriber | null>(null);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const started = useRef(false);
  const skipStorageCheck = useRef(false);
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [lowStorage, setLowStorage] = useState<StorageStatus | null>(null);
  const [justStarted, setJustStarted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [prompts, setPrompts] = useState(() => pickPrompts(3));
  const [prompt, setPrompt] = useState<string | null>(null);
  const [liveText, setLiveText] = useState('');
  const [draftInfo, setDraftInfo] = useState<{ durationMs: number; prompt: string | null } | null>(null);

  // one calm announcement per meaningful change (the timer and the changing headline stay silent)
  const [announcement, setAnnouncement] = useState('');
  const previousState = useRef<RecorderState>('idle');
  useEffect(() => {
    const prev = previousState.current;
    previousState.current = state;
    if (prev === state) return;
    if (state === 'recording') setAnnouncement(prev === 'paused' ? 'recording resumed.' : 'recording.');
    else if (state === 'paused') setAnnouncement('recording paused.');
    else if (state === 'stopping') setAnnouncement('saving your voicemail.');
  }, [state]);

  const active = state === 'recording' || state === 'paused' || state === 'starting' || state === 'stopping';

  // --- guard against leaving mid-recording (in-app navigation and closing the tab)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => active && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      recRef.current?.pause();
      setLeaving(true);
    }
  }, [blocker.state]);
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      recRef.current?.flush();
      e.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') recRef.current?.flush();
      // the browser drops the screen-awake lock when you switch away; take it back on return
      else if (recRef.current?.state === 'recording' || recRef.current?.state === 'paused') acquireWakeLock();
    };
    const onPageHide = () => recRef.current?.flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [active]);

  // --- timer
  useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => setElapsed(recRef.current?.elapsedMs() ?? 0), 200);
    return () => clearInterval(t);
  }, [state]);

  // --- draft info
  useEffect(() => {
    if (!draftId) return;
    db.voicemails.get(draftId).then((vm) => {
      if (!vm) {
        toast("couldn't find that unfinished thought.");
        nav('/', { replace: true });
        return;
      }
      setDraftInfo({ durationMs: vm.durationMs, prompt: vm.prompt });
      setElapsed(vm.durationMs);
      if (vm.prompt) setPrompt(vm.prompt);
    });
  }, [draftId, nav, toast]);

  // keep the screen on while recording (some phones stop the microphone when the screen sleeps)
  const acquireWakeLock = async () => {
    try {
      wakeLock.current =
        (await (navigator as unknown as { wakeLock?: { request(t: string): Promise<WakeLockSentinelLike> } }).wakeLock?.request('screen')) ?? null;
    } catch {
      /* wake lock is optional */
    }
  };

  const releaseWakeLock = () => {
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  };

  const stopTranscript = useCallback(async (id: string) => {
    if (!transcriber.current) return;
    const text = transcriber.current.stop();
    transcriber.current = null;
    if (text) await updateVoicemail(id, { transcript: text });
  }, []);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setError(null);
    if (!recordingSupported()) {
      setError("this browser can't record audio. try a recent version of chrome, safari, edge or firefox.");
      started.current = false;
      return;
    }
    // room is getting tight: say so *before* starting, and let the person decide (it's an estimate, so never a block)
    if (!skipStorageCheck.current) {
      const storage = await readStorageStatus();
      if (storage.level === 'low') {
        setLowStorage(storage);
        started.current = false;
        return;
      }
    }
    setLowStorage(null);
    player.pause();
    // the first time, the browser will ask — say so, so the pop-up isn't a surprise
    setAsking((await micPermission()) === 'prompt');
    const rec = new VoicemailRecorder({
      onState: setState,
      onError: (m) => toast(m),
      onInterrupted: () => {
        releaseWakeLock();
        toast('the microphone was interrupted. your thought is saved in unfinished thoughts.');
        nav('/', { replace: true });
      },
    });
    recRef.current = rec;
    try {
      if (settings.soundEffects) await playBeep();
      const id = await rec.start({ draftId: draftId ?? undefined, prompt });
      haptic(settings.haptics, 20);
      setJustStarted(true);
      setTimeout(() => setJustStarted(false), 1800);
      await acquireWakeLock();
      if (settings.liveTranscription && transcriptionSupported()) {
        const existing = draftId ? ((await db.voicemails.get(id))?.transcript ?? '') : '';
        const t = new LiveTranscriber(existing);
        t.onUpdate = (f, i) => setLiveText(`${f} ${i}`.trim());
        t.start();
        transcriber.current = t;
      }
    } catch (err) {
      started.current = false;
      recRef.current = null;
      setState('idle');
      setError(describeMicError(err));
    }
  }, [draftId, nav, prompt, settings.haptics, settings.liveTranscription, settings.soundEffects, toast]);

  const startAnyway = () => {
    skipStorageCheck.current = true;
    start();
  };

  // auto start when arriving from "leave a voicemail"
  useEffect(() => {
    if (autoStart && !draftId) start();
  }, [autoStart, draftId, start]);

  // stop everything if the component unmounts unexpectedly
  useEffect(
    () => () => {
      const r = recRef.current;
      if (r && (r.state === 'recording' || r.state === 'paused')) r.saveDraft();
      transcriber.current?.stop();
      releaseWakeLock();
    },
    [],
  );

  const pause = () => {
    recRef.current?.pause();
    transcriber.current?.pause();
    haptic(settings.haptics);
  };
  const resume = () => {
    recRef.current?.resume();
    transcriber.current?.resume();
    haptic(settings.haptics);
  };

  const finish = async () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      const id = await rec.finish();
      await stopTranscript(id);
      if (prompt) await updateVoicemail(id, { prompt });
      releaseWakeLock();
      if (settings.soundEffects) playClick();
      haptic(settings.haptics, [10, 40, 10]);
      blocker.reset?.();
      nav(`/voicemail/${id}/customize?new=1`, { replace: true });
    } catch (err) {
      toast((err as Error).message);
      releaseWakeLock();
      nav('/', { replace: true });
    }
  };

  const saveDraft = async () => {
    const rec = recRef.current;
    setLeaving(false);
    if (!rec) return;
    const id = await rec.saveDraft();
    if (id) {
      await stopTranscript(id);
      if (prompt) await updateVoicemail(id, { prompt });
      toast('kept in unfinished thoughts.');
    }
    releaseWakeLock();
    if (blocker.state === 'blocked') blocker.proceed();
    else nav('/', { replace: true });
  };

  const discard = async () => {
    setLeaving(false);
    transcriber.current?.stop();
    transcriber.current = null;
    if (draftInfo) {
      // continuing an unfinished thought: drop only what was just said
      await recRef.current?.discardSession();
      toast('kept what you had before.');
    } else {
      // a new recording goes to recently deleted, just in case
      const id = await recRef.current?.saveDraft();
      if (id) {
        await moveToDeleted(id);
        toast('moved to recently deleted, just in case.');
      } else toast('let go.');
    }
    releaseWakeLock();
    if (blocker.state === 'blocked') blocker.proceed();
    else nav('/', { replace: true });
  };

  const getPeaks = useCallback(() => {
    const r = recRef.current;
    return r ? (r.priorPeaks.length ? [...r.priorPeaks.slice(-400), ...r.livePeaks] : r.livePeaks) : [];
  }, []);

  const headline =
    state === 'paused'
      ? 'take your time.'
      : state === 'recording'
        ? justStarted
          ? 'beep…'
          : "go ahead. i'm listening."
        : draftInfo
          ? 'pick up where you left off.'
          : 'whenever you’re ready.';

  return (
    <main className={`record-screen state-${state}`}>
      <div className="record-top">
        <button
          className="icon-btn"
          aria-label={active ? 'cancel recording' : 'close'}
          onClick={() => {
            if (active) {
              pause();
              setLeaving(true);
            } else nav(-1);
          }}
        >
          <Icon name="close" />
        </button>
        {state === 'paused' && <span className="paused-badge">paused</span>}
        {state === 'recording' && (
          <span className="rec-badge">
            <span className="rec-dot" /> recording
          </span>
        )}
        <span style={{ width: 44 }} />
      </div>

      <p className="sr-only" role="status">
        {announcement}
      </p>

      <section className={`record-center ${lowStorage && state === 'idle' ? 'has-notice' : ''}`}>
        <h1 className="record-headline serif">
          {headline}
        </h1>

        {prompt && <p className="active-prompt serif">“{prompt}”</p>}

        <div className={`mic-orb ${state === 'recording' ? 'is-live' : ''}`} aria-hidden="true">
          <span className="orb-ring r1" />
          <span className="orb-ring r2" />
          <span className="orb-core">
            <Icon name="mic" size={40} />
          </span>
        </div>

        <p className="timer" aria-label="elapsed time" role="timer">
          {formatDuration(elapsed)}
        </p>

        <LiveWaveform getPeaks={getPeaks} active={state === 'recording'} />

        {liveText && state !== 'idle' && <p className="live-transcript">{liveText.slice(-220)}</p>}

        {lowStorage && state === 'idle' && (
          <div className="notice" role="alert">
            <p>
              space is getting tight on this device
              {lowStorage.freeBytes != null && ` — your browser estimates about ${formatBytes(lowStorage.freeBytes)} left`}. that's only an estimate, and a recording
              might not save if it runs out. you can free up space or back up first, or record anyway.
            </p>
            <div className="btn-row">
              <Link to="/you" className="btn btn-ghost btn-sm">
                manage space
              </Link>
              <button className="btn btn-gold btn-sm" onClick={startAnyway}>
                record anyway
              </button>
            </div>
          </div>
        )}
        {asking && state === 'starting' && <p className="muted small">your browser will ask to use the microphone — tap allow.</p>}
        {error && (
          <div className="error-note record-error" role="alert">
            <p>{error}</p>
            <button className="btn btn-gold btn-sm" onClick={start}>
              try again
            </button>
          </div>
        )}
      </section>

      <section className="record-controls">
        {(state === 'idle' || state === 'starting') && (
          <button className="rec-main" onClick={start} disabled={state === 'starting'} aria-label={draftInfo ? 'continue recording' : 'start recording'}>
            <Icon name="mic" size={34} />
          </button>
        )}
        {state === 'recording' && (
          <>
            <button className="ctrl" onClick={pause} aria-label="pause">
              <Icon name="pause" fill="currentColor" strokeWidth={0} size={26} />
              <span>pause</span>
            </button>
            <button className="ctrl ctrl-gold" onClick={finish} aria-label="finish">
              <Icon name="check" size={28} />
              <span>finish</span>
            </button>
          </>
        )}
        {state === 'paused' && (
          <>
            <button className="ctrl ctrl-gold" onClick={resume} aria-label="resume">
              <Icon name="mic" size={26} />
              <span>resume</span>
            </button>
            <button className="ctrl" onClick={finish} aria-label="finish">
              <Icon name="check" size={28} />
              <span>finish</span>
            </button>
          </>
        )}
        {state === 'stopping' && <p className="muted">keeping it safe…</p>}
      </section>

      {state === 'paused' && (
        <button className="link center-link" onClick={saveDraft}>
          save as an unfinished thought
        </button>
      )}

      {(state === 'idle' || state === 'recording' || state === 'paused') && (
        <section className="prompt-help">
          <button className="link" onClick={() => setShowPrompts((s) => !s)} aria-expanded={showPrompts}>
            need a little help?
          </button>
          {showPrompts && (
            <div className="prompt-list fade-in">
              {prompts.map((p) => (
                <button
                  key={p}
                  className={`prompt-chip ${prompt === p ? 'is-on' : ''}`}
                  onClick={() => {
                    const next = prompt === p ? null : p;
                    setPrompt(next);
                    if (recRef.current?.voicemailId) updateVoicemail(recRef.current.voicemailId, { prompt: next });
                  }}
                >
                  {p}
                </button>
              ))}
              <button className="icon-btn" onClick={() => setPrompts((cur) => pickPrompts(3, cur))} aria-label="more prompts">
                <Icon name="refresh" size={18} />
              </button>
            </div>
          )}
        </section>
      )}

      <Sheet
        open={leaving}
        onClose={() => {
          setLeaving(false);
          if (blocker.state === 'blocked') blocker.reset();
        }}
        title="stepping away?"
      >
        <p className="muted sheet-body">nothing is lost unless you choose it. what should happen to this one?</p>
        <div className="menu-list">
          <button className="menu-item" onClick={saveDraft}>
            <Icon name="draft" /> keep it as an unfinished thought
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setLeaving(false);
              if (blocker.state === 'blocked') blocker.reset();
              resume();
            }}
          >
            <Icon name="mic" /> keep talking
          </button>
          <button className="menu-item danger" onClick={discard}>
            <Icon name="trash" /> {draftInfo ? 'discard what i just said' : 'let it go (delete)'}
          </button>
        </div>
      </Sheet>
    </main>
  );
}
