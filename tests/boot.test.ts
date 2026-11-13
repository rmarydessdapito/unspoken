import { beforeEach, describe, expect, it, vi } from 'vitest';

// the real src/main.tsx, with everything around it replaced so only the start-up order is observed
const h = vi.hoisted(() => ({ calls: [] as string[], undo: (async () => false) as (...a: unknown[]) => Promise<boolean> }));

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: () => h.calls.push('render') }) }));
vi.mock('../src/App', () => ({ App: () => null }));
vi.mock('../src/components/ErrorBoundary', () => ({ ErrorBoundary: () => null }));
vi.mock('../src/components/LockGate', () => ({ LockGate: () => null }));
vi.mock('../src/components/Toast', () => ({ ToastProvider: () => null }));
vi.mock('../src/db/db', () => ({ requestPersistentStorage: () => undefined }));
vi.mock('../src/db/repo', () => ({
  undoInterruptedRestore: (...a: unknown[]) => h.undo(...a),
  recoverInterruptedRecordings: async () => (h.calls.push('recoverInterruptedRecordings'), 0),
  purgeOldDeleted: async () => (h.calls.push('purgeOldDeleted'), 0),
  getSettings: async () => ({}),
}));

async function start() {
  await import('../src/main'); // importing it runs boot()
  await vi.waitFor(() => expect(h.calls).toContain('render'));
}

beforeEach(() => {
  h.calls.length = 0;
  vi.resetModules();
  vi.restoreAllMocks();
  vi.stubGlobal('document', { getElementById: () => ({}) });
});

describe('app start-up', () => {
  it('undoes an interrupted restore first — before recording recovery and before anything is shown', async () => {
    const undo = vi.fn(async () => (h.calls.push('undoInterruptedRestore'), true));
    h.undo = undo;
    await start();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(['undoInterruptedRestore', 'recoverInterruptedRecordings', 'purgeOldDeleted', 'render']);
  });

  it('still opens the app, and still recovers recordings, when that undo itself fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.undo = vi.fn(async () => {
      h.calls.push('undoInterruptedRestore');
      throw new Error('storage unavailable');
    });
    await start();
    expect(h.calls).toEqual(['undoInterruptedRestore', 'recoverInterruptedRecordings', 'purgeOldDeleted', 'render']);
    expect(logged).toHaveBeenCalledWith('could not undo an interrupted restore', expect.any(Error));
  });
});
