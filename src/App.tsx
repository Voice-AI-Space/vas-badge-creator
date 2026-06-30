import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import {
  renderPixelPortrait,
  renderBitmap,
  renderAscii,
  renderBaseImage,
  ZOOM_MIN,
  ZOOM_MAX,
  type DitherMode,
} from "./lib/dither";
import { buildCaptions, EVENT_TYPES, type BadgeType } from "./lib/captions";

// Display order for the 2-column grid (row-major): TL, TR, BL, BR.
const BADGE_TYPES: BadgeType[] = [
  "I'm hosting",
  "I'm speaking at",
  "We're sponsoring",
  "I'm attending",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Badge canvas geometry — fixed, so the portrait can be rendered once into an
// offscreen buffer of known size and re-blitted cheaply on text edits.
const SIZE = 1080;
const CARD_PAD = 70;
const CARD_X = CARD_PAD;
const CARD_Y = CARD_PAD;
const CARD_W = SIZE - CARD_PAD * 2;
const CARD_H = SIZE - CARD_PAD * 2;
const INNER_PAD = 26;
const INNER_X = CARD_X + INNER_PAD;
const INNER_Y = CARD_Y + INNER_PAD;
const INNER_W = CARD_W - INNER_PAD * 2;
const INNER_H = CARD_H - INNER_PAD * 2;

type PortraitMode = "pixel" | "base" | "ascii" | "bitmap";

const PORTRAIT_MODES: { id: PortraitMode; label: string }[] = [
  { id: "base", label: "Base photo" },
  { id: "pixel", label: "Pixel portrait" },
  { id: "ascii", label: "ASCII" },
  { id: "bitmap", label: "Bitmap" },
];

interface PortraitParams {
  pixelSize: number;
  contrast: number;
  mode: DitherMode;
  zoom: number;
  asciiScale: number;
  baseGrayscale: boolean;
  offsetX: number;
  offsetY: number;
}

// Dispatch table keyed by mode — keeps the render call branch-free.
const PORTRAIT_RENDERERS: Record<
  PortraitMode,
  (img: HTMLImageElement, canvas: HTMLCanvasElement, p: PortraitParams) => void
> = {
  pixel: (img, c, p) =>
    renderPixelPortrait(img, c, {
      pixelSize: p.pixelSize,
      contrast: p.contrast,
      brightness: 0.05,
      mode: p.mode,
      zoom: p.zoom,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    }),
  bitmap: (img, c, p) =>
    renderBitmap(img, c, {
      pixelSize: p.pixelSize,
      contrast: p.contrast,
      brightness: 0.05,
      zoom: p.zoom,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    }),
  ascii: (img, c, p) =>
    renderAscii(img, c, {
      scale: p.asciiScale,
      contrast: p.contrast,
      brightness: 0.05,
      zoom: p.zoom,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    }),
  base: (img, c, p) =>
    renderBaseImage(img, c, {
      zoom: p.zoom,
      grayscale: p.baseGrayscale,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    }),
};

// Copy text to the clipboard, falling back to the legacy execCommand path when
// the async Clipboard API is unavailable (e.g. blocked inside a preview iframe).
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function App() {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [badge, setBadge] = useState<BadgeType>("I'm hosting");
  const [eventName, setEventName] = useState("Global Mixer");
  const [city, setCity] = useState("Colombo");
  const [month, setMonth] = useState("August");
  const [date, setDate] = useState("20");
  const [pixelSize, setPixelSize] = useState(3);
  const [contrast, setContrast] = useState(1.4);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<DitherMode>("atkinson");
  const [portraitMode, setPortraitMode] = useState<PortraitMode>("base");
  const [asciiScale, setAsciiScale] = useState(8);
  const [baseGrayscale, setBaseGrayscale] = useState(true);
  // Pan offset within the crop, normalized to [-1, 1] per axis (0 = centered).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Selected variant index per platform card.
  const [variantIdx, setVariantIdx] = useState<Record<string, number>>({});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setOffset({ x: 0, y: 0 }); // recenter for the new image
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImgEl(im);
      URL.revokeObjectURL(url);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      setFileName("");
      toast.error("Couldn't load that image. Try a JPG or PNG.");
    };
    im.src = url;
  }, []);

  // Drag the preview to pan the crop. Pointer deltas (in CSS px) are scaled to
  // the 1080px canvas, then to the [-1,1] offset range over the portrait box.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!imgEl) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, y: e.clientY };
    },
    [imgEl],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    const canvas = canvasRef.current;
    if (!start || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width; // CSS px → 1080px canvas px
    const dx = (e.clientX - start.x) * scale;
    const dy = (e.clientY - start.y) * scale;
    dragRef.current = { x: e.clientX, y: e.clientY };
    // Dragging the image right reveals its left side → offset decreases.
    setOffset((o) => ({
      x: Math.max(-1, Math.min(1, o.x - dx / (INNER_W / 2))),
      y: Math.max(-1, Math.min(1, o.y - dy / (INNER_H / 2))),
    }));
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // The expensive dithering only depends on the image + FX inputs, so cache the
  // rendered portrait in an offscreen canvas and recompute it only when those
  // change — not on every event-name/city keystroke.
  const portrait = useMemo(() => {
    if (!imgEl) return null;
    const port = document.createElement("canvas");
    port.width = INNER_W;
    port.height = INNER_H;
    PORTRAIT_RENDERERS[portraitMode](imgEl, port, {
      pixelSize,
      contrast,
      mode,
      zoom,
      asciiScale,
      baseGrayscale,
      offsetX: offset.x,
      offsetY: offset.y,
    });
    return port;
  }, [
    imgEl,
    portraitMode,
    pixelSize,
    contrast,
    mode,
    zoom,
    asciiScale,
    baseGrayscale,
    offset.x,
    offset.y,
  ]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // 1. Black grid background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    const GRID = 60;
    for (let x = 0; x <= SIZE; x += GRID) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= SIZE; y += GRID) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(SIZE, y + 0.5);
      ctx.stroke();
    }

    // 2. Outer white card with thick white border
    ctx.fillStyle = "#fff";
    ctx.fillRect(CARD_X, CARD_Y, CARD_W, CARD_H);

    // Inner frame: light grey fill behind portrait area
    ctx.fillStyle = "#ededed";
    ctx.fillRect(INNER_X, INNER_Y, INNER_W, INNER_H);

    // 3. Portrait area — blit the cached offscreen portrait
    if (portrait) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(portrait, INNER_X, INNER_Y);
    } else {
      // Placeholder
      ctx.fillStyle = "#bbb";
      ctx.font = "600 28px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("UPLOAD A SELFIE", INNER_X + INNER_W / 2, INNER_Y + INNER_H / 2 - 16);
      ctx.font = "400 18px 'IBM Plex Mono', monospace";
      ctx.fillText("portrait renders here", INNER_X + INNER_W / 2, INNER_Y + INNER_H / 2 + 22);
    }

    // 4. White label box near lower-left of portrait area (e.g. "I'm hosting")
    ctx.font = "600 30px 'IBM Plex Mono', monospace";
    const labelText = badge;
    const labelPadX = 22;
    const labelPadY = 14;
    const tm = ctx.measureText(labelText);
    const labelW = Math.ceil(tm.width) + labelPadX * 2;
    const labelH = 30 + labelPadY * 2;
    // Position above the bottom info bar
    const barH = 168;
    const barY = INNER_Y + INNER_H - barH;
    const labelX = INNER_X + 30;
    const labelY = barY - labelH - 18;
    // black outline (1px black, then white box) to mimic reference
    ctx.fillStyle = "#000";
    ctx.fillRect(labelX - 2, labelY - 2, labelW + 4, labelH + 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, labelX + labelPadX, labelY + labelH / 2 + 1);

    // 5. Bottom black information bar
    const barX = INNER_X + 8;
    const barW = INNER_W - 16;
    const barYAdj = INNER_Y + INNER_H - barH - 8;
    const realBarH = barH - 8;
    ctx.fillStyle = "#000";
    ctx.fillRect(barX, barYAdj, barW, realBarH);

    // Two lines, vertically centered as a block within the bar.
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";

    const mono = (weight: string, size: number, italic = false) =>
      `${italic ? "italic " : ""}${weight} ${size}px 'IBM Plex Mono', monospace`;

    const centerY = barYAdj + realBarH / 2;
    const lineGap = 58; // distance between the two baselines
    const line1Y = centerY - lineGap / 2;
    const line2Y = centerY + lineGap / 2;
    const leftX = barX + 28;
    const rightX = barX + barW - 28;
    const COL_GAP = 28; // minimum gap between the left text and the right column

    const safeCity = city.trim() || "City";
    const safeEvent = eventName.trim() || "Global Mixer";
    const line2Text = `${safeEvent} "${safeCity}"`;

    // Measure the fixed-size right column first so the left lines know their room.
    ctx.font = mono("600", 34);
    const monthW = ctx.measureText(month).width;
    ctx.font = mono("700", 34);
    const dateW = ctx.measureText(date).width;

    // Auto-shrink each left line so long names never collide with the right column.
    const measureLine1 = (size: number) => {
      ctx.font = mono("700", size);
      const a = ctx.measureText("VOICE AI / ").width;
      ctx.font = mono("600", size, true);
      return a + ctx.measureText("Space").width;
    };
    const measureLine2 = (size: number) => {
      ctx.font = mono("700", size);
      return ctx.measureText(line2Text).width;
    };
    const size1 = fitFontSize(measureLine1, 40, rightX - monthW - COL_GAP - leftX, 20);
    const size2 = fitFontSize(measureLine2, 38, rightX - dateW - COL_GAP - leftX, 18);

    // Line 1: "VOICE AI / Space" — "Space" italic
    ctx.textAlign = "left";
    ctx.font = mono("700", size1);
    ctx.fillText("VOICE AI / ", leftX, line1Y);
    const w1 = ctx.measureText("VOICE AI / ").width;
    ctx.font = mono("600", size1, true);
    ctx.fillText("Space", leftX + w1, line1Y);

    // Line 2: Event name + "City"
    ctx.font = mono("700", size2);
    ctx.fillText(line2Text, leftX, line2Y);

    // Right side: month + date stacked, aligned to the same two baselines
    ctx.textAlign = "right";
    ctx.font = mono("600", 34);
    ctx.fillText(month, rightX, line1Y);
    ctx.font = mono("700", 34);
    ctx.fillText(date, rightX, line2Y);
  }, [portrait, badge, eventName, city, month, date]);

  // Draw on every relevant change, and again once the web font loads so the
  // first paint (and an immediate download) uses IBM Plex Mono, not a fallback.
  useEffect(() => {
    draw();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) draw();
    });
    return () => {
      cancelled = true;
    };
  }, [draw]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = `${eventName}-${city}-${month}-${date}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      a.download = `vas-badge-${slug || "voice-ai-space"}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const captions = useMemo(
    () => buildCaptions({ badge, eventName, city, month, date }),
    [badge, eventName, city, month, date],
  );

  const copyCaption = async (key: string, text: string) => {
    if (await copyToClipboard(text)) {
      setCopiedId(key);
      setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 1800);
    } else {
      toast.error("Couldn't copy. Select the caption and copy it manually.");
    }
  };

  return (
    <main className="min-h-screen grid-bg">
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <header className="flex items-end justify-between border-b border-border pb-6 mb-8 flex-wrap gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
              VOICE&nbsp;AI&nbsp;/&nbsp;<em className="not-italic">Space</em> &nbsp;·&nbsp;
              community badge utility
            </div>
            <h1 className="font-mono font-bold text-3xl md:text-5xl mt-2 tracking-tight">
              VAS BADGE<span className="text-muted-foreground"> // </span>GENERATOR
            </h1>
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            <span className="inline-block bg-white text-black px-2 py-1">v1.0</span>
            <span className="ml-3">1080×1080 · PNG · monochrome</span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
          {/* CONTROLS */}
          <section className="space-y-6">
            {/* Upload */}
            <Panel label="01 · UPLOAD SELFIE">
              <label className="block cursor-pointer border border-dashed border-border bg-secondary hover:bg-accent transition-colors p-6 text-center">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <div className="font-mono text-sm">
                  {fileName ? (
                    <>
                      <div className="text-foreground">{fileName}</div>
                      <div className="text-muted-foreground text-xs mt-1">click to replace</div>
                    </>
                  ) : (
                    <>
                      <div className="text-foreground">[ + ] drop or click to upload</div>
                      <div className="text-muted-foreground text-xs mt-1">
                        jpg / png · square crops best
                      </div>
                    </>
                  )}
                </div>
              </label>
            </Panel>

            {/* Badge type */}
            <Panel label="02 · BADGE TYPE">
              <div className="grid grid-cols-2 gap-2">
                {BADGE_TYPES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBadge(b)}
                    aria-pressed={badge === b}
                    className={`font-mono text-sm px-3 py-3 border text-left transition-colors ${
                      badge === b
                        ? "bg-white text-black border-white"
                        : "bg-secondary text-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </Panel>

            {/* Event details */}
            <Panel label="03 · EVENT DETAILS">
              <div className="space-y-3">
                <Field label="Event type">
                  <select
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    className="vinput"
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="City">
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="vinput"
                    placeholder="Colombo"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Month">
                    <select
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="vinput"
                    >
                      {MONTHS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date">
                    <input
                      value={date}
                      onChange={(e) => setDate(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      className="vinput"
                      placeholder="20"
                      inputMode="numeric"
                    />
                  </Field>
                </div>
              </div>
            </Panel>

            {/* Portrait tuning */}
            <Panel label="04 · PORTRAIT FX">
              <div className="space-y-4">
                <Field label="Portrait style">
                  <div className="grid grid-cols-2 gap-2">
                    {PORTRAIT_MODES.map((pm) => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPortraitMode(pm.id)}
                        aria-pressed={portraitMode === pm.id}
                        className={`font-mono text-xs uppercase px-2 py-2 border ${
                          portraitMode === pm.id
                            ? "bg-white text-black border-white"
                            : "bg-secondary border-border hover:bg-accent"
                        }`}
                      >
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field
                  label={`Zoom · ${zoom.toFixed(2)}× ${zoom < 1 ? "(wider)" : zoom > 1 ? "(closer)" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))}
                      className="font-mono text-sm px-3 py-1 border border-border bg-secondary hover:bg-accent"
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={0.05}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full accent-white"
                      aria-label="Zoom"
                    />
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))}
                      className="font-mono text-sm px-3 py-1 border border-border bg-secondary hover:bg-accent"
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setZoom(1);
                        setOffset({ x: 0, y: 0 });
                      }}
                      className="font-mono text-[11px] px-2 py-1 border border-border bg-secondary hover:bg-accent uppercase"
                      title="Reset zoom and position"
                    >
                      1:1
                    </button>
                  </div>
                </Field>
                {portraitMode === "base" && (
                  <Field label="Color">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setBaseGrayscale(true)}
                        aria-pressed={baseGrayscale}
                        className={`font-mono text-xs uppercase px-2 py-2 border ${
                          baseGrayscale
                            ? "bg-white text-black border-white"
                            : "bg-secondary border-border hover:bg-accent"
                        }`}
                      >
                        Black &amp; white
                      </button>
                      <button
                        type="button"
                        onClick={() => setBaseGrayscale(false)}
                        aria-pressed={!baseGrayscale}
                        className={`font-mono text-xs uppercase px-2 py-2 border ${
                          !baseGrayscale
                            ? "bg-white text-black border-white"
                            : "bg-secondary border-border hover:bg-accent"
                        }`}
                      >
                        Color
                      </button>
                    </div>
                  </Field>
                )}
                {(portraitMode === "pixel" || portraitMode === "bitmap") && (
                  <Field label={`Pixel size · ${pixelSize}px`}>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={pixelSize}
                      onChange={(e) => setPixelSize(Number(e.target.value))}
                      className="w-full accent-white"
                    />
                  </Field>
                )}
                {portraitMode === "ascii" && (
                  <Field label={`Character size · ${asciiScale}px`}>
                    <input
                      type="range"
                      min={5}
                      max={16}
                      value={asciiScale}
                      onChange={(e) => setAsciiScale(Number(e.target.value))}
                      className="w-full accent-white"
                    />
                  </Field>
                )}
                {portraitMode !== "base" && (
                  <Field label={`Contrast · ${contrast.toFixed(2)}`}>
                    <input
                      type="range"
                      min={0.6}
                      max={2.2}
                      step={0.05}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                      className="w-full accent-white"
                    />
                  </Field>
                )}
                {portraitMode === "pixel" && (
                  <Field label="Dither algorithm">
                    <div className="grid grid-cols-3 gap-2">
                      {(["atkinson", "floyd", "bayer"] as DitherMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          aria-pressed={mode === m}
                          className={`font-mono text-xs uppercase px-2 py-2 border ${
                            mode === m
                              ? "bg-white text-black border-white"
                              : "bg-secondary border-border hover:bg-accent"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
            </Panel>

            {/* Actions */}
            <button
              onClick={download}
              disabled={!imgEl}
              className="w-full font-mono font-bold text-sm uppercase tracking-wider bg-white text-black px-4 py-4 hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed border border-white"
            >
              ↓ Download PNG
            </button>
            <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
              Tip: square selfies with clean lighting and a plain background dither best. Bump
              contrast for sharper bitmap edges.
            </p>
          </section>

          {/* PREVIEW */}
          <section className="space-y-4">
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              <span>preview · 1080×1080</span>
              <span>{imgEl ? "drag to reposition" : "○ awaiting upload"}</span>
            </div>
            <div className="border border-border bg-black p-3">
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`VAS event badge preview: ${badge} ${eventName} "${city}", ${month} ${date}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={`w-full h-auto block ${imgEl ? "cursor-grab active:cursor-grabbing" : ""}`}
                style={{ imageRendering: "pixelated", touchAction: imgEl ? "none" : undefined }}
              />
            </div>
            <div className="space-y-3">
              <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
                ready-to-post captions
              </div>
              {captions.map((c) => {
                const n = c.variants.length;
                const i = (variantIdx[c.id] ?? 0) % n;
                const text = c.variants[i];
                const key = `${c.id}-${i}`;
                const step = (delta: number) =>
                  setVariantIdx((m) => ({ ...m, [c.id]: ((m[c.id] ?? 0) + delta + n) % n }));
                return (
                  <div key={c.id} className="border border-border bg-secondary p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        {c.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyCaption(key, text)}
                        className="font-mono text-[11px] uppercase tracking-wider bg-white text-black border border-white px-3 py-1 hover:bg-foreground/90"
                      >
                        {copiedId === key ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-foreground/80">
                      {text}
                    </div>
                    {n > 1 && (
                      <div className="flex items-center justify-end gap-2 font-mono text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => step(-1)}
                          aria-label="Previous wording"
                          className="text-sm px-2 py-1 border border-border bg-secondary hover:bg-accent"
                        >
                          ←
                        </button>
                        <span className="text-[11px] tabular-nums">
                          {i + 1}/{n}
                        </span>
                        <button
                          type="button"
                          onClick={() => step(1)}
                          aria-label="Next wording"
                          className="text-sm px-2 py-1 border border-border bg-secondary hover:bg-accent"
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="mt-12 pt-6 border-t border-border font-mono text-[11px] text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>
            VOICE AI / <em className="not-italic">Space</em> · community badges
          </span>
          <span>monochrome · square · no rounded corners · est. 2026</span>
        </footer>
      </div>

      <style>{`
        .vinput {
          width: 100%;
          background: var(--color-input);
          color: var(--color-foreground);
          border: 1px solid var(--color-border);
          padding: 10px 12px;
          font-family: var(--font-mono);
          font-size: 14px;
          outline: none;
        }
        .vinput:focus { border-color: #fff; }
      `}</style>
    </main>
  );
}

// Step a font size down from baseSize until the measured text fits maxWidth.
function fitFontSize(
  measure: (size: number) => number,
  baseSize: number,
  maxWidth: number,
  minSize: number,
): number {
  let size = baseSize;
  while (size > minSize && measure(size) > maxWidth) size -= 1;
  return size;
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border border-border bg-muted">
      <div className="px-4 py-2 border-b border-border bg-secondary font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}
