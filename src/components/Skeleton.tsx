/**
 * Quiet placeholders shown while the library is read from the device (usually a blink).
 * They hold the shape of what's coming — so nothing jumps, and "nothing here yet" never flashes first.
 */
function Card() {
  return (
    <div className="skel-card" aria-hidden="true">
      <div className="skel skel-cover" />
      <div className="skel skel-line" />
      <div className="skel skel-line short" />
    </div>
  );
}

function Status({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="sr-only">loading…</span>
      {children}
    </div>
  );
}

/** a row of album-cover placeholders, like the shelves on Home */
export function ShelfSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Status className="shelf">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} />
      ))}
    </Status>
  );
}

/** placeholders in the library's grid or list layout */
export function LibrarySkeleton({ view, count = 6 }: { view: 'grid' | 'list'; count?: number }) {
  if (view === 'list') {
    return (
      <Status className="list">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skel-row" aria-hidden="true">
            <div className="skel skel-thumb" />
            <div className="skel-row-text">
              <div className="skel skel-line" />
              <div className="skel skel-line short" />
            </div>
          </div>
        ))}
      </Status>
    );
  }
  return (
    <Status className="grid">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} />
      ))}
    </Status>
  );
}

/** a whole page while one voicemail or collection loads */
export function PageSkeleton() {
  return (
    <main className="screen" aria-busy="true">
      <span className="sr-only" role="status">
        loading…
      </span>
      <div className="skel-page" aria-hidden="true">
        <div className="skel skel-cover skel-hero" />
        <div className="skel skel-line skel-title" />
        <div className="skel skel-line short" />
      </div>
    </main>
  );
}
