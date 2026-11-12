import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { deleteImage, hasSavedAudio, isLocked, markPlayed, moveToDeleted, restoreDeleted, saveImage, updateVoicemail } from '../db/repo';
import { SealedView, UnlockReveal } from '../components/FutureMe';
import { CollectionPicker } from '../components/CollectionPicker';
import { Cover } from '../components/Cover';
import { CoverPicker } from '../components/CoverPicker';
import { PhotoStrip } from '../components/Fields';
import { Icon } from '../components/Icon';
import { PageSkeleton } from '../components/Skeleton';
import { Confirm, Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Waveform } from '../components/Waveform';
import { usePlayer } from '../hooks/usePlayer';
import { useNow } from '../hooks/useNow';
import { canShareFiles, voicemailAudioFile } from '../lib/audioExport';
import { downloadBlob } from '../lib/backup';
import { displayTitle, formatDate, formatDuration, formatTime } from '../lib/format';
import { player } from '../lib/player';
import { PageHeader } from './parts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function Detail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(30_000);
  const vm = useLiveQuery(() => db.voicemails.get(id), [id]);
  const collections = useLiveQuery(() => db.collections.where('voicemailIds').equals(id).toArray(), [id]) ?? [];
  const snap = usePlayer();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [colOpen, setColOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');

  const locked = vm ? isLocked(vm, now) : false;
  const current = snap.voicemailId === id;

  // if playback fails, offer a download only when the audio is really still saved here
  const [retrying, setRetrying] = useState(false);
  const [downloadable, setDownloadable] = useState(false);
  const playbackFailed = current && !!snap.error;
  useEffect(() => {
    let live = true;
    if (!playbackFailed || !vm) {
      setDownloadable(false);
      return;
    }
    hasSavedAudio(vm)
      .then((ok) => live && setDownloadable(ok))
      .catch(() => live && setDownloadable(false));
    return () => {
      live = false;
    };
  }, [playbackFailed, vm]);

  if (vm === undefined) return <PageSkeleton />;
  if (!vm || vm.status === 'recording') {
    return (
      <main className="screen">
        <PageHeader title="not here" back />
        <p className="empty">this voicemail doesn't exist anymore.</p>
      </main>
    );
  }
  if (vm.status === 'deleted') {
    return (
      <main className="screen">
        <PageHeader title="recently deleted" back />
        <p className="empty">
          this voicemail is in recently deleted.{' '}
          <button
            className="link"
            onClick={async () => {
              await restoreDeleted(vm.id);
              toast('restored.');
            }}
          >
            restore it
          </button>{' '}
          to listen again.
        </p>
      </main>
    );
  }
  if (locked) {
    return (
      <main className="screen detail sealed">
        <PageHeader title="for future me" back />
        <SealedView vm={vm} />
      </main>
    );
  }
  // first time opening a future-me voicemail after its day arrives
  if (vm.unlockAt != null && !vm.unlockSeen) {
    return (
      <main className="screen detail">
        <PageHeader title="" back />
        <UnlockReveal vm={vm} onOpen={() => updateVoicemail(vm.id, { unlockSeen: true })} />
      </main>
    );
  }

  const title = displayTitle(vm);
  const position = current ? snap.positionMs : 0;
  const progress = vm.durationMs ? position / vm.durationMs : 0;

  const ensureLoaded = async () => {
    if (!current) {
      await player.load(vm);
      await markPlayed(vm.id);
    }
  };
  const togglePlay = async () => {
    if (!current) {
      await ensureLoaded();
      await player.play();
    } else await player.toggle();
  };
  const seek = async (fraction: number) => {
    await ensureLoaded();
    await player.seek(fraction * vm.durationMs);
  };
  const skip = async (ms: number) => {
    await ensureLoaded();
    await player.skip(ms);
  };

  const retryPlayback = async () => {
    setRetrying(true);
    try {
      if (await player.retry()) toast('back on track.');
    } finally {
      setRetrying(false);
    }
  };

  const download = async () => {
    setBusy('preparing your audio…');
    try {
      const file = await voicemailAudioFile(vm);
      downloadBlob(file, file.name);
    } catch {
      toast("couldn't prepare the audio file.");
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setShareOpen(false);
    setBusy('preparing your audio…');
    try {
      const file = await voicemailAudioFile(vm);
      if (canShareFiles(file)) {
        await navigator.share({ files: [file], title });
      } else {
        downloadBlob(file, file.name);
        toast("sharing isn't available here, so i saved the file instead.");
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') toast("couldn't share this one.");
    } finally {
      setBusy(null);
    }
  };

  const replaceArtwork = async (blob: Blob | null) => {
    const old = vm.coverId;
    await updateVoicemail(vm.id, { coverId: blob ? await saveImage(blob) : null });
    await deleteImage(old);
  };

  return (
    <main className="screen detail">
      <PageHeader
        title=""
        back
        right={
          <Link to={`/voicemail/${vm.id}/customize`} className="icon-btn" aria-label="edit details">
            <Icon name="edit" />
          </Link>
        }
      />

      {/* on wide screens: cover on the left, everything else on the right */}
      <div className="split">
        <div className="split-aside">
          <div className="detail-cover fade-in">
            <CoverPicker imageId={vm.coverId} onChange={replaceArtwork} label="replace artwork">
              <Cover imageId={vm.coverId} seed={vm.id} title={title} peaks={vm.peaks} size="lg" />
            </CoverPicker>
          </div>
        </div>

        <div className="split-main">
          <h1 className="detail-title serif">{title}</h1>
          <p className="detail-sub">
            {formatDate(vm.recordedAt)} · {formatTime(vm.recordedAt)} · {formatDuration(vm.durationMs)}
          </p>
          {vm.prompt && <p className="detail-prompt">in answer to “{vm.prompt}”</p>}
          {vm.description && <p className="detail-desc">{vm.description}</p>}

          {(vm.mood || vm.tags.length > 0) && (
            <div className="chips detail-chips">
              {vm.mood && <span className="chip is-on static">{vm.mood}</span>}
              {vm.tags.map((t) => (
                <Link key={t} to={`/library?tag=${encodeURIComponent(t)}`} className="chip chip-ghost">
                  #{t}
                </Link>
              ))}
            </div>
          )}

          <section className="player-card">
            <Waveform peaks={vm.peaks} progress={progress} onSeek={seek} durationMs={vm.durationMs} />
            <div className="player-times">
              <span>{formatDuration(position)}</span>
              <span>-{formatDuration(Math.max(0, vm.durationMs - position))}</span>
            </div>
            <div className="player-controls">
              <button className="icon-btn" onClick={() => skip(-10_000)} aria-label="rewind 10 seconds">
                <Icon name="back10" size={28} />
              </button>
              <button className="play-btn play-lg" onClick={togglePlay} aria-label={current && snap.playing ? 'pause' : 'play'}>
                <Icon name={current && snap.playing ? 'pause' : 'play'} fill="currentColor" strokeWidth={0} size={30} />
              </button>
              <button className="icon-btn" onClick={() => skip(10_000)} aria-label="forward 10 seconds">
                <Icon name="fwd10" size={28} />
              </button>
            </div>
            <div className="speeds" role="radiogroup" aria-label="playback speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={snap.rate === s}
                  className={`speed ${snap.rate === s ? 'is-on' : ''}`}
                  onClick={() => player.setRate(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
            {current && snap.error && (
              <div className="error-note playback-error" role="alert">
                <p>{snap.error}</p>
                {(snap.canRetry || downloadable) && (
                  <div className="btn-row">
                    {snap.canRetry && (
                      <button className="btn btn-gold btn-sm" onClick={retryPlayback} disabled={retrying}>
                        {retrying ? 'trying…' : 'try again'}
                      </button>
                    )}
                    {downloadable && (
                      <button className="btn btn-ghost btn-sm" onClick={download}>
                        download it instead
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="action-row">
            <button className="action" onClick={() => setColOpen(true)}>
              <Icon name="folder" />
              <span>collect</span>
            </button>
            <button className="action" onClick={download}>
              <Icon name="download" />
              <span>download</span>
            </button>
            <button className="action" onClick={() => setShareOpen(true)}>
              <Icon name="share" />
              <span>share</span>
            </button>
            <button className="action danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" />
              <span>delete</span>
            </button>
          </div>
          {busy && <p className="muted small center">{busy}</p>}

          {collections.length > 0 && (
            <p className="small muted">
              kept in{' '}
              {collections.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link to={`/collection/${c.id}`} className="link">
                    {c.title}
                  </Link>
                </span>
              ))}
            </p>
          )}

          {vm.photoIds.length > 0 && (
            <section className="section">
              <h2 className="section-title serif">little photos</h2>
              <PhotoStrip ids={vm.photoIds} />
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title serif">transcript</h2>
              {vm.transcript && !editingTranscript && (
                <button className="link small" onClick={() => updateVoicemail(vm.id, { transcriptVisible: !vm.transcriptVisible })}>
                  {vm.transcriptVisible ? 'hide' : 'show'}
                </button>
              )}
            </div>
            {editingTranscript ? (
              <>
                <textarea className="input" rows={6} value={transcriptDraft} onChange={(e) => setTranscriptDraft(e.target.value)} aria-label="transcript" />
                <div className="sheet-actions">
                  <button className="btn btn-ghost" onClick={() => setEditingTranscript(false)}>
                    cancel
                  </button>
                  <button
                    className="btn btn-gold"
                    onClick={async () => {
                      await updateVoicemail(vm.id, { transcript: transcriptDraft.trim(), transcriptVisible: true });
                      setEditingTranscript(false);
                    }}
                  >
                    save
                  </button>
                </div>
              </>
            ) : vm.transcript ? (
              vm.transcriptVisible && (
                <div className="reading-surface">
                  <p>{vm.transcript}</p>
                  <button
                    className="link small"
                    onClick={() => {
                      setTranscriptDraft(vm.transcript);
                      setEditingTranscript(true);
                    }}
                  >
                    edit transcript
                  </button>
                </div>
              )
            ) : (
              <p className="muted small">
                no transcript. the audio is the entry —{' '}
                <button
                  className="link"
                  onClick={() => {
                    setTranscriptDraft('');
                    setEditingTranscript(true);
                  }}
                >
                  write one
                </button>{' '}
                or turn on live transcription under “you”.
              </p>
            )}
          </section>
        </div>
      </div>

      <CollectionPicker voicemailId={vm.id} open={colOpen} onClose={() => setColOpen(false)} />

      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="share this voicemail?">
        <p className="muted sheet-body">
          this sends a copy of your recording outside unspoken, to whoever or wherever you choose next. it stays private here — nothing is ever shared unless
          you say so.
        </p>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setShareOpen(false)}>
            keep it private
          </button>
          <button className="btn btn-gold" onClick={share}>
            yes, share a copy
          </button>
        </div>
      </Sheet>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="delete this voicemail?"
        body="it moves to recently deleted, where you can restore it for 30 days. after that it's gone for good."
        confirmLabel="delete"
        danger
        onConfirm={async () => {
          if (snap.voicemailId === vm.id) player.unload();
          await moveToDeleted(vm.id);
          toast('moved to recently deleted.');
          nav('/library', { replace: true });
        }}
      />
    </main>
  );
}
