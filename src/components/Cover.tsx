import { useImageUrl } from '../hooks/useImageUrl';
import { downsamplePeaks } from '../lib/library';

// Palette-only "album covers" for voicemails saved without artwork.
const VARIANTS = [
  { bg: '#07515C', ink: '#F1E9D9', accent: '#B18118' },
  { bg: '#292A28', ink: '#F1E9D9', accent: '#B18118' },
  { bg: '#89531F', ink: '#F1E9D9', accent: '#F1E9D9' },
  { bg: '#F1E9D9', ink: '#292A28', accent: '#89531F' },
  { bg: '#19383B', ink: '#F1E9D9', accent: '#B18118' },
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}

interface CoverProps {
  imageId: string | null | undefined;
  seed: string;
  title: string;
  peaks?: number[];
  size?: 'sm' | 'md' | 'lg';
  locked?: boolean;
  className?: string;
}

/** Square cover art inside a thin antique-gold frame. */
export function Cover({ imageId, seed, title, peaks = [], size = 'md', locked, className = '' }: CoverProps) {
  const url = useImageUrl(imageId);
  const v = VARIANTS[hash(seed) % VARIANTS.length];
  const bars = downsamplePeaks(peaks, 24);
  return (
    <div className={`cover cover-${size} ${className}`} aria-hidden="true">
      {url && !locked ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <div className="cover-generated" style={{ background: v.bg, color: v.ink }}>
          {locked ? (
            <div className="cover-sealed" style={{ color: v.accent }}>
              <svg viewBox="0 0 24 24" width="38%" height="38%" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
              </svg>
            </div>
          ) : (
            <>
              {size !== 'sm' && <span className="cover-title">{title}</span>}
              <svg className="cover-wave" viewBox="0 0 96 24" preserveAspectRatio="none" style={{ color: v.accent }}>
                {bars.map((p, i) => {
                  const h = Math.max(1.5, p * 22);
                  return <rect key={i} x={i * 4 + 0.8} y={12 - h / 2} width={2.2} height={h} rx={1.1} fill="currentColor" />;
                })}
              </svg>
            </>
          )}
        </div>
      )}
    </div>
  );
}
