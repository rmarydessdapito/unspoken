// Image helpers: downscale uploads so long-lived libraries stay small, and crop covers to a square.

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("that image couldn't be opened."));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not save image'))), 'image/jpeg', quality));
}

/** Shrink a photo so its longest side is at most `max` px. */
export async function downscale(file: Blob, max = 1600): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvasToBlob(canvas);
}

export interface CropState {
  zoom: number; // >= 1
  x: number; // offset of image centre from frame centre, in frame-size units
  y: number;
}

/**
 * Render the square crop the user framed. The image is drawn "cover"-fit into the frame,
 * then scaled by zoom and shifted by x/y (fractions of frame size).
 */
export async function renderSquareCrop(img: HTMLImageElement, crop: CropState, size = 1080): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const base = size / Math.min(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * base * crop.zoom;
  const h = img.naturalHeight * base * crop.zoom;
  c.drawImage(img, size / 2 - w / 2 + crop.x * size, size / 2 - h / 2 + crop.y * size, w, h);
  return canvasToBlob(canvas, 0.9);
}

/** keep the image covering the frame — no empty edges */
export function clampCrop(img: { naturalWidth: number; naturalHeight: number }, crop: CropState): CropState {
  const base = 1 / Math.min(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * base * crop.zoom;
  const h = img.naturalHeight * base * crop.zoom;
  const maxX = Math.max(0, (w - 1) / 2);
  const maxY = Math.max(0, (h - 1) / 2);
  return { zoom: crop.zoom, x: Math.max(-maxX, Math.min(maxX, crop.x)), y: Math.max(-maxY, Math.min(maxY, crop.y)) };
}
