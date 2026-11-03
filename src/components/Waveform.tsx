import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { downsamplePeaks } from '../lib/library';

/**
 * Static waveform drawn from the peaks captured while recording.
 * Interactive: tap or drag to seek. Keyboard: ← / → seek 5s.
 */
export function Waveform({
  peaks,
  progress,
  onSeek,
  height = 72,
  label = 'playback position',
  durationMs = 0,
}: {
  peaks: number[];
  progress: number; // 0..1
  onSeek?: (fraction: number) => void;
  height?: number;
  label?: string;
  durationMs?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const barW = 3;
  const gap = 2;
  const count = Math.max(8, Math.floor(width / (barW + gap)));
  const bars = downsamplePeaks(peaks, count);

  const fractionAt = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  return (
    <div
      ref={wrap}
      className={`waveform ${onSeek ? 'is-interactive' : ''}`}
      style={{ height }}
      role={onSeek ? 'slider' : undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={onSeek ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onSeek || !durationMs) return;
        const step = 5000 / durationMs;
        if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + step));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - step));
      }}
      onPointerDown={(e) => {
        if (!onSeek) return;
        dragging.current = true;
        try {
          (e.target as Element).setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer already released — dragging still works without capture */
        }
        onSeek(fractionAt(e));
      }}
      onPointerMove={(e) => dragging.current && onSeek?.(fractionAt(e))}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <svg width="100%" height={height} viewBox={`0 0 ${count * (barW + gap)} ${height}`} preserveAspectRatio="none">
        {bars.map((p, i) => {
          const h = Math.max(2, p * (height - 6));
          const played = i / count < progress;
          return <rect key={i} x={i * (barW + gap)} y={(height - h) / 2} width={barW} height={h} rx={1.5} className={played ? 'wf-played' : 'wf-rest'} />;
        })}
      </svg>
    </div>
  );
}

/** Scrolling live waveform for the recording screen. Reads levels from a ref so it never re-renders React. */
export function LiveWaveform({ getPeaks, active, height = 96 }: { getPeaks: () => number[]; active: boolean; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        if (c.width !== w * dpr) {
          c.width = w * dpr;
          c.height = height * dpr;
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, height);
        const barW = 3;
        const gap = 3;
        const n = Math.floor(w / (barW + gap));
        const peaks = getPeaks();
        const slice = peaks.slice(-n);
        const offset = n - slice.length;
        const gold = getComputedStyle(c).getPropertyValue('--gold').trim() || '#B18118';
        for (let i = 0; i < n; i++) {
          const p = i >= offset ? slice[i - offset] : 0;
          const h = Math.max(2, p * (height - 8));
          ctx.globalAlpha = i >= offset ? 0.35 + 0.65 * ((i - offset) / Math.max(1, slice.length)) : 0.18;
          ctx.fillStyle = gold;
          const x = i * (barW + gap);
          const y = (height - h) / 2;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(x, y, barW, h, 1.5) : ctx.rect(x, y, barW, h);
          ctx.fill();
        }
      }
      if (active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, getPeaks, height]);
  return <canvas ref={canvas} className="live-waveform" style={{ height }} aria-hidden="true" />;
}
