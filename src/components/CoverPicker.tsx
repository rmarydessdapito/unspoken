import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent, type ReactNode } from 'react';
import { clampCrop, downscale, loadImage, renderSquareCrop, type CropState } from '../lib/images';
import { useImageUrl } from '../hooks/useImageUrl';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

/** Square crop & reposition: drag to move, slider / pinch-wheel to zoom. */
export function CropEditor({ file, onDone, onCancel }: { file: Blob; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    loadImage(file)
      .then((i) => !cancelled && setImg(i))
      .catch(() => {
        toast("that image couldn't be opened.");
        onCancel();
      });
    return () => {
      cancelled = true;
    };
  }, [file, onCancel, toast]);

  const update = (c: CropState) => img && setCrop(clampCrop(img, c));

  const onDown = (e: PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released — dragging still works without capture */
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current || !frame.current) return;
    const size = frame.current.clientWidth;
    update({ ...crop, x: drag.current.cx + (e.clientX - drag.current.x) / size, y: drag.current.cy + (e.clientY - drag.current.y) / size });
  };

  const style = (() => {
    if (!img) return {};
    const base = 1 / Math.min(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * base * crop.zoom * 100;
    const h = img.naturalHeight * base * crop.zoom * 100;
    return { width: `${w}%`, height: `${h}%`, left: `${50 - w / 2 + crop.x * 100}%`, top: `${50 - h / 2 + crop.y * 100}%` };
  })();

  return (
    <div className="crop">
      <div
        className="crop-frame"
        ref={frame}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => update({ ...crop, zoom: Math.min(4, Math.max(1, crop.zoom - e.deltaY / 600)) })}
      >
        {img && <img src={img.src} alt="" style={style} draggable={false} />}
      </div>
      <label className="field">
        <span className="label">zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })}
          aria-label="zoom"
        />
      </label>
      <p className="muted small center">drag to reposition</p>
      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          cancel
        </button>
        <button
          className="btn btn-gold"
          disabled={!img || busy}
          onClick={async () => {
            if (!img) return;
            setBusy(true);
            try {
              onDone(await renderSquareCrop(img, crop));
            } finally {
              setBusy(false);
            }
          }}
        >
          use this
        </button>
      </div>
    </div>
  );
}

/**
 * Choose / take / crop / replace / remove a square cover image.
 * `onChange` receives the new cropped blob, or null to remove.
 */
export function CoverPicker({
  imageId,
  onChange,
  label = 'cover art',
  children,
}: {
  imageId: string | null;
  onChange: (blob: Blob | null) => void | Promise<void>;
  label?: string;
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState<Blob | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const currentUrl = useImageUrl(imageId);

  const pick = (input: HTMLInputElement | null) => {
    setMenu(false);
    input?.click();
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPending(f);
  };

  return (
    <>
      <button type="button" className="cover-picker" onClick={() => setMenu(true)} aria-label={`${label}: ${imageId ? 'change' : 'add'}`}>
        {children}
        <span className="cover-picker-badge">
          <Icon name={imageId ? 'edit' : 'image'} size={16} /> {imageId ? 'change' : 'add artwork'}
        </span>
      </button>
      <input ref={gallery} type="file" accept="image/*" hidden onChange={onFile} data-testid="cover-gallery-input" />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      <Sheet open={menu} onClose={() => setMenu(false)} title={label}>
        <div className="menu-list">
          <button className="menu-item" onClick={() => pick(gallery.current)}>
            <Icon name="image" /> choose from your photos
          </button>
          <button className="menu-item" onClick={() => pick(camera.current)}>
            <Icon name="camera" /> take a photo
          </button>
          {imageId && currentUrl && (
            <button
              className="menu-item"
              onClick={async () => {
                setMenu(false);
                setPending(await (await fetch(currentUrl)).blob());
              }}
            >
              <Icon name="edit" /> crop & reposition
            </button>
          )}
          {imageId && (
            <button
              className="menu-item danger"
              onClick={() => {
                setMenu(false);
                onChange(null);
              }}
            >
              <Icon name="trash" /> remove artwork
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={!!pending} onClose={() => setPending(null)} title="frame it">
        {pending && (
          <CropEditor
            file={pending}
            onCancel={() => setPending(null)}
            onDone={async (blob) => {
              setPending(null);
              await onChange(blob);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Pick one or more extra photos (not the cover). */
export function PhotoAdder({ onAdd }: { onAdd: (blobs: Blob[]) => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="photo-add" onClick={() => input.current?.click()} disabled={busy} aria-label="add photos">
        <Icon name="plus" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            const blobs = await Promise.all(files.map((f) => downscale(f)));
            await onAdd(blobs);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
