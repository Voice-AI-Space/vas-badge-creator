// Portrait renderers for the badge — pixel-art dithering, hard 1-bit bitmap,
// ASCII art, and a plain (optionally grayscale) base photo. They share one
// cover-crop + low-res luma sampling step so the four modes stay consistent.

export type DitherMode = "atkinson" | "floyd" | "bayer";

// UI-facing zoom bounds (slider range).
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
// Internal render-safety clamp — slightly wider than the slider so programmatic
// callers can't produce a degenerate crop.
const RENDER_ZOOM_MIN = 0.4;
const RENDER_ZOOM_MAX = 3;

// Luma coefficients (Rec. 601) — single source of truth for every desaturation.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export interface CoverCrop {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Compute a square cover-crop of a source image into a destination of size
 * destW×destH, with a zoom factor (>1 zooms in, <1 shows more and pads with the
 * destination's background) and an optional pan offset. offsetX/offsetY ∈ [-1,1]
 * slide the crop across the available travel (0 = centered, ±1 = source edge),
 * so panning never reveals past the source. Negative source offsets are
 * converted into destination offsets so the caller can fill the background first.
 */
export function computeCoverCrop(
  sw: number,
  sh: number,
  destW: number,
  destH: number,
  zoom: number,
  offsetX = 0,
  offsetY = 0,
): CoverCrop {
  const z = Math.max(RENDER_ZOOM_MIN, Math.min(RENDER_ZOOM_MAX, zoom || 1));
  const side = Math.min(sw, sh) / z;
  const clampedSide = Math.min(side, Math.min(sw, sh) * 2.5);
  // Centered position plus a pan that's clamped to the leftover travel.
  const halfPanX = (sw - clampedSide) / 2;
  const halfPanY = (sh - clampedSide) / 2;
  const ox = Math.max(-1, Math.min(1, offsetX));
  const oy = Math.max(-1, Math.min(1, offsetY));
  const sx = halfPanX + ox * Math.abs(halfPanX);
  const sy = halfPanY + oy * Math.abs(halfPanY);
  const dx = sx < 0 ? Math.round((-sx / clampedSide) * destW) : 0;
  const dy = sy < 0 ? Math.round((-sy / clampedSide) * destH) : 0;
  const srcX = Math.max(0, sx);
  const srcY = Math.max(0, sy);
  const srcW = Math.min(sw - srcX, clampedSide - (srcX - sx));
  const srcH = Math.min(sh - srcY, clampedSide - (srcY - sy));
  const dw = Math.round((srcW / clampedSide) * destW);
  const dh = Math.round((srcH / clampedSide) * destH);
  return { srcX, srcY, srcW, srcH, dx, dy, dw, dh };
}

type Source = HTMLImageElement | HTMLCanvasElement;

function sourceSize(source: Source): { sw: number; sh: number } {
  const sw = (source as HTMLImageElement).naturalWidth ?? (source as HTMLCanvasElement).width;
  const sh = (source as HTMLImageElement).naturalHeight ?? (source as HTMLCanvasElement).height;
  return { sw, sh };
}

/**
 * Cover-crop the source into a cols×rows grid and return per-cell luma (0..255)
 * with contrast/brightness applied. Shared by the pixel, bitmap and ASCII modes.
 */
function sampleLuma(
  source: Source,
  cols: number,
  rows: number,
  contrast: number,
  brightness: number,
  zoom: number,
  offsetX = 0,
  offsetY = 0,
): Float32Array {
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d", { willReadFrequently: true })!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  const { sw, sh } = sourceSize(source);
  // White background first so zoomed-out crops (negative offsets) pad cleanly.
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, cols, rows);
  const crop = computeCoverCrop(sw, sh, cols, rows, zoom, offsetX, offsetY);
  octx.drawImage(
    source,
    crop.srcX,
    crop.srcY,
    crop.srcW,
    crop.srcH,
    crop.dx,
    crop.dy,
    crop.dw,
    crop.dh,
  );

  const data = octx.getImageData(0, 0, cols, rows).data;
  const gray = new Float32Array(cols * rows);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    let g = (LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2]) / 255;
    g = (g - 0.5) * contrast + 0.5 + brightness;
    gray[j] = Math.max(0, Math.min(1, g)) * 255;
  }
  return gray;
}

/** Binarize the luma grid in place via the chosen error-diffusion / ordered kernel. */
function ditherInPlace(gray: Float32Array, lowW: number, lowH: number, mode: DitherMode) {
  if (mode === "bayer") {
    const m = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    for (let y = 0; y < lowH; y++) {
      for (let x = 0; x < lowW; x++) {
        const t = (m[y % 4][x % 4] + 0.5) * (255 / 16);
        const i = y * lowW + x;
        gray[i] = gray[i] > t ? 255 : 0;
      }
    }
    return;
  }

  for (let y = 0; y < lowH; y++) {
    for (let x = 0; x < lowW; x++) {
      const i = y * lowW + x;
      const old = gray[i];
      const nu = old < 128 ? 0 : 255;
      gray[i] = nu;
      const err = old - nu;
      const push = (dx: number, dy: number, f: number) => {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= lowW || ny < 0 || ny >= lowH) return;
        gray[ny * lowW + nx] += err * f;
      };
      if (mode === "floyd") {
        push(1, 0, 7 / 16);
        push(-1, 1, 3 / 16);
        push(0, 1, 5 / 16);
        push(1, 1, 1 / 16);
      } else {
        // atkinson — leaves bright highlights, classic mac look
        push(1, 0, 1 / 8);
        push(2, 0, 1 / 8);
        push(-1, 1, 1 / 8);
        push(0, 1, 1 / 8);
        push(1, 1, 1 / 8);
        push(0, 2, 1 / 8);
      }
    }
  }
}

/** Threshold a luma grid to black/white and upscale crisply onto the target. */
function blitBinaryUpscaled(
  gray: Float32Array,
  lowW: number,
  lowH: number,
  target: HTMLCanvasElement,
) {
  const off = document.createElement("canvas");
  off.width = lowW;
  off.height = lowH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(lowW, lowH);
  const data = img.data;
  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const v = gray[j] > 127 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);

  const tctx = target.getContext("2d")!;
  tctx.imageSmoothingEnabled = false;
  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, target.width, target.height);
  tctx.drawImage(off, 0, 0, lowW, lowH, 0, 0, target.width, target.height);
}

interface OneBitOpts {
  pixelSize?: number; // logical pixel block size (1 = finest)
  contrast?: number;
  brightness?: number;
  zoom?: number;
  offsetX?: number; // pan ∈ [-1,1]
  offsetY?: number;
}

/** Sample → (optionally dither) → threshold → upscale. Pixel and bitmap share this. */
function renderOneBit(
  source: Source,
  target: HTMLCanvasElement,
  opts: OneBitOpts,
  dither: DitherMode | null,
) {
  const pixelSize = opts.pixelSize ?? 3;
  const contrast = opts.contrast ?? 1.35;
  const brightness = opts.brightness ?? 0.05;
  const lowW = Math.max(1, Math.floor(target.width / pixelSize));
  const lowH = Math.max(1, Math.floor(target.height / pixelSize));
  const gray = sampleLuma(
    source,
    lowW,
    lowH,
    contrast,
    brightness,
    opts.zoom ?? 1,
    opts.offsetX ?? 0,
    opts.offsetY ?? 0,
  );
  if (dither) ditherInPlace(gray, lowW, lowH, dither);
  blitBinaryUpscaled(gray, lowW, lowH, target);
}

/** Dithered 1-bit pixel portrait (Atkinson / Floyd / Bayer). */
export function renderPixelPortrait(
  source: Source,
  target: HTMLCanvasElement,
  opts: OneBitOpts & { mode?: DitherMode } = {},
) {
  renderOneBit(source, target, opts, opts.mode ?? "atkinson");
}

/** Hard 1-bit bitmap — straight luma threshold, no dithering. */
export function renderBitmap(source: Source, target: HTMLCanvasElement, opts: OneBitOpts = {}) {
  renderOneBit(source, target, opts, null);
}

// Dark → light ramp; index 0 is the densest glyph, last entry is blank.
const ASCII_RAMP = "@%#*+=-:. ";

/**
 * Stretch the luma grid so its real tonal range fills 0..255 (histogram
 * auto-levels with percentile clipping). This is what makes an ASCII portrait
 * actually readable — photos cluster in the midtones, so without it every cell
 * maps to the same handful of glyphs and the face disappears.
 */
function autoLevels(gray: Float32Array, clipFraction: number) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] < 0 ? 0 : gray[i] > 255 ? 255 : gray[i];
    hist[Math.round(v)]++;
  }
  const clipCount = gray.length * clipFraction;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > clipCount) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > clipCount) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) return; // flat image — nothing to stretch
  const range = hi - lo;
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] - lo) / range;
    gray[i] = Math.max(0, Math.min(1, v)) * 255;
  }
}

/** ASCII-art portrait: black monospace glyphs on white, density ∝ darkness. */
export function renderAscii(
  source: Source,
  target: HTMLCanvasElement,
  opts: {
    scale?: number;
    contrast?: number;
    brightness?: number;
    zoom?: number;
    offsetX?: number;
    offsetY?: number;
  } = {},
) {
  const scale = Math.max(3, opts.scale ?? 8); // character cell height in target px
  const contrast = opts.contrast ?? 1.35;
  const charH = scale;
  const charW = Math.max(1, Math.round(scale * 0.6)); // monospace advance ≈ 0.6em
  const cols = Math.max(1, Math.floor(target.width / charW));
  const rows = Math.max(1, Math.floor(target.height / charH));

  // Sample raw luma (no pre-contrast so detail isn't crushed before levelling),
  // auto-level to fill the ramp, then apply the user's contrast as a gentle
  // mid-tone curve on the normalized data.
  const gray = sampleLuma(
    source,
    cols,
    rows,
    1,
    0,
    opts.zoom ?? 1,
    opts.offsetX ?? 0,
    opts.offsetY ?? 0,
  );
  autoLevels(gray, 0.02);
  // Apply the user's contrast, then a darkening gamma so mid-tones land on the
  // denser glyphs — without it the portrait reads too light to make out.
  const GAMMA = 1.6;
  for (let i = 0; i < gray.length; i++) {
    let v = (gray[i] / 255 - 0.5) * contrast + 0.5;
    v = Math.pow(Math.max(0, Math.min(1, v)), GAMMA);
    gray[i] = v * 255;
  }

  const ctx = target.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.fillStyle = "#000";
  // Bold glyphs deposit more ink per cell, so dark regions actually read dark.
  ctx.font = `700 ${charH}px 'IBM Plex Mono', monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const last = ASCII_RAMP.length - 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = Math.min(last, Math.floor((gray[y * cols + x] / 255) * ASCII_RAMP.length));
      const ch = ASCII_RAMP[idx];
      if (ch === " ") continue;
      ctx.fillText(ch, x * charW, y * charH);
    }
  }
}

/** Plain photo, cover-cropped — optionally desaturated to grayscale. */
export function renderBaseImage(
  source: Source,
  target: HTMLCanvasElement,
  opts: { zoom?: number; grayscale?: boolean; offsetX?: number; offsetY?: number } = {},
) {
  const W = target.width;
  const H = target.height;
  const ctx = target.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  const { sw, sh } = sourceSize(source);
  const crop = computeCoverCrop(sw, sh, W, H, opts.zoom ?? 1, opts.offsetX ?? 0, opts.offsetY ?? 0);
  ctx.drawImage(
    source,
    crop.srcX,
    crop.srcY,
    crop.srcW,
    crop.srcH,
    crop.dx,
    crop.dy,
    crop.dw,
    crop.dh,
  );

  if (!opts.grayscale) return;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}
