import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './styles/global.css';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LockGate } from './components/LockGate';
import { ToastProvider } from './components/Toast';
import { requestPersistentStorage } from './db/db';
import { getSettings, purgeOldDeleted, recoverInterruptedRecordings, undoInterruptedRestore } from './db/repo';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  let initiallyLocked = false;
  let recovered = 0;
  try {
    // a restore that was cut off halfway is undone first, so the library is exactly as it was before it began
    await undoInterruptedRestore().catch((e) => console.error('could not undo an interrupted restore', e));
    // never lose a recording: anything interrupted last time becomes an unfinished thought
    recovered = await recoverInterruptedRecordings();
    // voicemails in recently deleted for more than 30 days are erased for good
    await purgeOldDeleted().catch(() => 0);
    const s = await getSettings();
    initiallyLocked = !!s.passcodeHash;
    if (s.onboarded) requestPersistentStorage();
  } catch (err) {
    console.error(err);
    root.render(
      <div className="fatal">
        <p className="wordmark">unspoken</p>
        <p>i couldn't open your private storage. if you're in a private / incognito window, try a normal one.</p>
      </div>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <LockGate initiallyLocked={initiallyLocked}>
            <App />
          </LockGate>
          {recovered > 0 && <RecoveredNote count={recovered} />}
        </ToastProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

function RecoveredNote({ count }: { count: number }) {
  return (
    <div className="toasts">
      <div className="toast">
        {count === 1
          ? 'a recording was interrupted last time — it’s safe in unfinished thoughts.'
          : `${count} interrupted recordings are safe in unfinished thoughts.`}
      </div>
    </div>
  );
}

boot();
