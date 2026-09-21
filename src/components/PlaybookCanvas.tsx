'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import { detectBlueHotspots, annotateWithMarkers, annotateWithCenterMarkers } from '@/lib/detectHotspots';
import { buttonIcon, buttonOutline, buttonPrimary } from '@/lib/styles';

type Props = {
  imageDataUrl: string | null;
  imageName: string | null;
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  anthropicApiKey: string;
  figmaApiKey: string;
  figmaFileUrl: string;
  onImageChange: (dataUrl: string, name: string) => void;
  onBoxesChange: (boxes: PlaybookBox[]) => void;
  onSelectBox: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onClearAll: () => void;
  onFigmaFileUrlChange: (url: string) => void;
};

type View = { scale: number; x: number; y: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `box-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PlaybookCanvas({
  imageDataUrl,
  imageName,
  boxes,
  activeBoxId,
  anthropicApiKey,
  figmaApiKey,
  figmaFileUrl,
  onImageChange,
  onBoxesChange,
  onSelectBox,
  onOpenEditor,
  onClearAll,
  onFigmaFileUrlChange,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSyncingFigma, setIsSyncingFigma] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [connections, setConnections] = useState<{ from: string; to: string }[] | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const [isDetectingConnections, setIsDetectingConnections] = useState(false);
  const dragState = useRef<{
    boxId: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origBox: PlaybookBox;
  } | null>(null);
  const panState = useRef<{ startX: number; startY: number; origin: View } | null>(null);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onImageChange(reader.result, file.name);
        }
      };
      reader.readAsDataURL(file);
    },
    [onImageChange],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) readFile(file);
  };

  // Scales and centers the image so the whole thing is visible in the
  // viewport — the "frame the PNG within the frame" reset. Refuses to act on
  // a not-yet-laid-out viewport (width/height ~0) rather than locking in a
  // bogus near-zero scale that nothing would ever recalculate afterward.
  const fitToFrame = useCallback(() => {
    const viewport = viewportRef.current;
    const natural = naturalSizeRef.current;
    if (!viewport || !natural || natural.width === 0 || natural.height === 0) return;
    // clientWidth/clientHeight (content + padding, no border) is the actual
    // containing block the absolutely-positioned image is placed within —
    // using the border-box getBoundingClientRect() here would leave the
    // image consistently off-center by the border width.
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width < 2 || height < 2) return;
    const scale = clamp(Math.min(width / natural.width, height / natural.height), MIN_SCALE, MAX_SCALE);
    setView({
      scale,
      x: (width - natural.width * scale) / 2,
      y: (height - natural.height * scale) / 2,
    });
  }, []);

  // The viewport's CSS Grid track can still be mid-layout the instant the
  // image finishes decoding — fitting against that would lock in a bogus
  // scale that nothing ever recalculates afterward. A transient collapsed
  // width (e.g. exactly the horizontal padding, content width 0) is easy to
  // mistake for "laid out" since it's non-zero — that false positive is what
  // let a bad fit slip through and stick. So instead of disarming after one
  // "good enough" sample, keep re-fitting on every viewport resize until the
  // user manually pans/zooms (`hasInteractedRef`) — cheap, idempotent while
  // untouched, and self-correcting no matter how many resize passes it takes
  // to reach the real final layout.
  const hasInteractedRef = useRef(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (hasInteractedRef.current) return;
      fitToFrame();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitToFrame]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    naturalSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
    hasInteractedRef.current = false;
    fitToFrame();
    // The ResizeObserver above only refires when the viewport's own size
    // *changes* — it can't help if the very first read was wrong for a
    // reason that isn't a subsequent resize (e.g. a web font swapping in a
    // frame or two after this fires, briefly-wrong layout during a large
    // image's decode). Re-running fitToFrame for a few more frames right
    // after load catches that case too, and is a no-op once layout has
    // actually settled — self-terminates the moment the user pans/zooms.
    let frames = 0;
    const retry = () => {
      if (hasInteractedRef.current || frames >= 15) return;
      frames += 1;
      fitToFrame();
      requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  };

  // Zoom by `factor`, keeping the given viewport-relative point fixed on
  // screen (cursor for wheel/pinch, viewport center for the +/- buttons) —
  // the same "zoom toward what you're pointing at" feel as Figma.
  const zoomBy = useCallback((factor: number, center?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    hasInteractedRef.current = true;
    const rect = viewport.getBoundingClientRect();
    const pivot = center ?? { x: rect.width / 2, y: rect.height / 2 };
    setView((v) => {
      const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const stageX = (pivot.x - v.x) / v.scale;
      const stageY = (pivot.y - v.y) / v.scale;
      return { scale: newScale, x: pivot.x - stageX * newScale, y: pivot.y - stageY * newScale };
    });
  }, []);

  // Native (non-passive) wheel listener — React's onWheel can't reliably
  // preventDefault the page scroll, but we need to fully own scroll/pinch
  // gestures here the way an infinite canvas does.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !imageDataUrl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom on a trackpad is reported as a wheel event with
        // ctrlKey set — same gesture Figma treats as zoom.
        zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY), cursor);
      } else {
        hasInteractedRef.current = true;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [imageDataUrl, zoomBy]);

  // Drag-to-pan on empty canvas — hotspot elements carry data-hotspot and
  // are excluded so their own click/drag handlers keep working untouched.
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-hotspot]')) return;
    e.preventDefault();
    hasInteractedRef.current = true;
    panState.current = { startX: e.clientX, startY: e.clientY, origin: view };

    const handleMove = (moveEvent: PointerEvent) => {
      const state = panState.current;
      if (!state) return;
      setView({
        scale: state.origin.scale,
        x: state.origin.x + (moveEvent.clientX - state.startX),
        y: state.origin.y + (moveEvent.clientY - state.startY),
      });
    };
    const handleUp = () => {
      panState.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const addBox = () => {
    const newBox: PlaybookBox = {
      id: makeId(),
      label: `Playbook ${boxes.length + 1}`,
      instructions: '',
      x: 35,
      y: 35,
      width: 30,
      height: 12,
    };
    onBoxesChange([...boxes, newBox]);
    onSelectBox(newBox.id);
  };

  const clearAll = () => {
    if (!imageDataUrl && boxes.length === 0) return;
    const proceed = window.confirm(
      'This removes the uploaded image and every playbook box, including their written instructions. Continue?',
    );
    if (!proceed) return;
    naturalSizeRef.current = null;
    setView({ scale: 1, x: 0, y: 0 });
    onClearAll();
  };

  const removeBox = (id: string) => {
    onBoxesChange(boxes.filter((b) => b.id !== id));
  };

  const renameBox = (id: string, label: string) => {
    onBoxesChange(boxes.map((b) => (b.id === id ? { ...b, label } : b)));
  };

  const startDrag = (
    e: React.PointerEvent,
    box: PlaybookBox,
    mode: 'move' | 'resize',
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { boxId: box.id, mode, startX: e.clientX, startY: e.clientY, origBox: box };

    const handleMove = (moveEvent: PointerEvent) => {
      const state = dragState.current;
      const wrapper = wrapperRef.current;
      if (!state || !wrapper) return;
      // getBoundingClientRect() reflects the wrapper's current on-screen
      // (zoomed) size, and moveEvent deltas are in the same screen space —
      // so this percentage math stays correct at any zoom level unchanged.
      const rect = wrapper.getBoundingClientRect();
      const dxPct = ((moveEvent.clientX - state.startX) / rect.width) * 100;
      const dyPct = ((moveEvent.clientY - state.startY) / rect.height) * 100;

      onBoxesChange(
        boxes.map((b) => {
          if (b.id !== state.boxId) return b;
          if (state.mode === 'move') {
            const x = Math.min(Math.max(state.origBox.x + dxPct, 0), 100 - b.width);
            const y = Math.min(Math.max(state.origBox.y + dyPct, 0), 100 - b.height);
            return { ...b, x, y };
          }
          const width = Math.min(Math.max(state.origBox.width + dxPct, 4), 100 - b.x);
          const height = Math.min(Math.max(state.origBox.height + dyPct, 4), 100 - b.y);
          return { ...b, width, height };
        }),
      );
    };

    const handleUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const runAutoDetect = async () => {
    if (!imageDataUrl) return;
    if (boxes.length > 0) {
      const proceed = window.confirm(
        'This will replace all existing playbook boxes and their written content. Continue?',
      );
      if (!proceed) return;
    }
    setIsDetecting(true);
    try {
      const img = new Image();
      img.src = imageDataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not load image'));
      });
      const rects = detectBlueHotspots(img);
      if (rects.length === 0) {
        window.alert('No blue buttons were detected in this image.');
        return;
      }

      // Read the real printed labels from the image BEFORE creating any
      // boxes — never invent sequential names ("Playbook 1", "Playbook 2"…)
      // and pass them off as if they came from the diagram. If this fails,
      // say so plainly rather than silently naming boxes something that
      // looks like a real detected label but isn't.
      let labels: string[] = [];
      let detectionFailed = false;
      try {
        const annotatedImageDataUrl = annotateWithMarkers(img, rects);
        const res = await fetch('/api/detect-labels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotatedImageDataUrl, count: rects.length, anthropicApiKey }),
        });
        const data = (await res.json()) as { labels: string[]; error?: string };
        if (res.ok && data.labels?.length === rects.length) {
          labels = data.labels;
        } else {
          detectionFailed = true;
        }
      } catch {
        detectionFailed = true;
      }

      if (detectionFailed) {
        window.alert(
          "Couldn't read the playbook names printed in the image (check your Anthropic API key under " +
          '"API keys", then try again). The boxes were still positioned correctly — rename each one by hand for now.',
        );
      }

      const newBoxes: PlaybookBox[] = rects.map((r, i) => ({
        id: makeId(),
        // A label the image-reading step actually found; never a made-up
        // sequential number standing in for one.
        label: labels[i]?.trim() || `Untitled box ${i + 1}`,
        instructions: '',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }));

      onBoxesChange(newBoxes);
    } catch {
      window.alert('Auto-detect failed. Try a different image.');
    } finally {
      setIsDetecting(false);
    }
  };

  // Pulls box content and *real* connections (not vision-guessed ones)
  // straight from a FigJam board's own data via the Figma REST API. The
  // image is still required separately for the visual canvas — this only
  // replaces the boxes, using the board's own coordinate space normalized
  // to 0-100%, so positions line up as long as the uploaded PNG was
  // exported from roughly the same layout.
  const runFigmaSync = async () => {
    const url = window.prompt('Paste the FigJam board URL to sync from:', figmaFileUrl || '');
    if (!url) return;
    if (!figmaApiKey.trim()) {
      window.alert('Add a Figma personal access token under "API keys" first.');
      return;
    }
    if (boxes.length > 0) {
      const proceed = window.confirm(
        'This will replace all existing playbook boxes and their written content. Continue?',
      );
      if (!proceed) return;
    }
    setIsSyncingFigma(true);
    try {
      const res = await fetch('/api/sync-figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: url, figmaApiKey }),
      });
      const data = (await res.json()) as {
        boxes: PlaybookBox[];
        error?: string;
        debugBounds?: { minX: number; minY: number; spanX: number; spanY: number };
      };
      if (!res.ok || data.error) {
        window.alert(data.error ?? 'Sync failed.');
        return;
      }
      if (data.debugBounds) {
        // Temporary calibration aid — compare against Figma's own Export
        // panel dimensions for this same selection to nail the exact
        // scale/offset correction instead of guessing at another heuristic.
        console.log('Figma sync computed bounds:', data.debugBounds);
      }
      onFigmaFileUrlChange(url);
      onBoxesChange(data.boxes);
    } catch {
      window.alert('Sync failed. Check your connection and try again.');
    } finally {
      setIsSyncingFigma(false);
    }
  };

  // A previously-detected set of connections stops matching reality the
  // moment a box moves, gets added/removed, or the image changes — drop the
  // cache so the toggle re-detects instead of showing stale arrows. Comparing
  // against a remembered signature and adjusting state inline during render
  // (React's documented pattern for "reset state when an input changes") —
  // not in an effect — avoids an extra render pass just to clear it.
  const boxesSignature = `${imageDataUrl ?? ''}::${boxes
    .map((b) => `${b.id}:${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`)
    .join('|')}`;
  const [detectedForSignature, setDetectedForSignature] = useState(boxesSignature);
  if (boxesSignature !== detectedForSignature) {
    setDetectedForSignature(boxesSignature);
    setConnections(null);
    setShowConnections(false);
  }

  const toggleConnections = async () => {
    if (showConnections) {
      setShowConnections(false);
      return;
    }
    if (connections) {
      setShowConnections(true);
      return;
    }
    if (!imageDataUrl || boxes.length < 2) return;
    setIsDetectingConnections(true);
    try {
      const img = new Image();
      img.src = imageDataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not load image'));
      });
      const annotatedImageDataUrl = annotateWithCenterMarkers(img, boxes);
      const res = await fetch('/api/detect-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotatedImageDataUrl, count: boxes.length, anthropicApiKey }),
      });
      const data = (await res.json()) as { connections: { from: number; to: number }[]; error?: string };
      if (!res.ok) {
        window.alert('Could not read connections (check your Anthropic API key under "API keys" and try again).');
        return;
      }
      const resolved = data.connections
        .map(({ from, to }) => ({ from: boxes[from - 1]?.id, to: boxes[to - 1]?.id }))
        .filter((c): c is { from: string; to: string } => Boolean(c.from && c.to && c.from !== c.to));
      if (resolved.length === 0) {
        window.alert("Couldn't confidently trace any arrows in this image.");
        return;
      }
      setConnections(resolved);
      setShowConnections(true);
    } catch {
      window.alert('Connection detection failed. Try again.');
    } finally {
      setIsDetectingConnections(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => fileInputRef.current?.click()} className={buttonPrimary}>
          {imageDataUrl ? 'Replace image' : 'Upload image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
        <button onClick={runAutoDetect} disabled={!imageDataUrl || isDetecting} className={buttonOutline}>
          {isDetecting ? 'Detecting…' : 'Auto-detect blue buttons'}
        </button>
        <button
          onClick={runFigmaSync}
          disabled={!imageDataUrl || isSyncingFigma}
          className={buttonOutline}
          title="Pull box content and real connections straight from a FigJam board (requires a Figma personal access token under API keys)"
        >
          {isSyncingFigma ? 'Syncing…' : 'Sync from Figma'}
        </button>
        <button onClick={addBox} disabled={!imageDataUrl} className={buttonOutline}>
          + Add playbook box
        </button>
        <button
          onClick={toggleConnections}
          disabled={!imageDataUrl || boxes.length < 2 || isDetectingConnections}
          aria-pressed={showConnections}
          title="Detect the arrows drawn between boxes and show them as an overlay"
          className={showConnections ? buttonPrimary : buttonOutline}
        >
          {isDetectingConnections ? 'Reading connections…' : showConnections ? 'Hide connections' : 'Show connections'}
        </button>
        <button
          onClick={clearAll}
          disabled={!imageDataUrl && boxes.length === 0}
          className={buttonOutline}
          title="Remove the uploaded image and every playbook box"
        >
          Clear image &amp; boxes
        </button>
        {imageName && <span className="font-label text-[11px] text-muted-ink">{imageName}</span>}

        {imageDataUrl && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => zoomBy(1 / 1.25)}
              className={`h-[30px] w-[30px] ${buttonIcon}`}
              title="Zoom out"
            >
              −
            </button>
            <span className="w-11 text-center font-label text-[11px] tabular-nums text-muted-ink">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              onClick={() => zoomBy(1.25)}
              className={`h-[30px] w-[30px] ${buttonIcon}`}
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => {
                hasInteractedRef.current = false;
                fitToFrame();
              }}
              className={buttonOutline}
              title="Fit the image back within the frame"
            >
              Reset view
            </button>
          </div>
        )}
      </div>

      <div
        ref={viewportRef}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={handleDrop}
        onPointerDown={imageDataUrl ? handleBackgroundPointerDown : undefined}
        className={`relative h-[840px] touch-none overflow-hidden border-2 border-dashed p-3 transition-colors duration-100 ${
          isDraggingFile ? 'border-ink bg-ink text-paper' : 'border-hair bg-muted'
        } ${imageDataUrl ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {!imageDataUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-ink">
            <p className="font-display text-lg text-ink">Drop a flow diagram image here</p>
            <p className="font-label text-[11px] uppercase tracking-widest">or click &ldquo;Upload image&rdquo; above</p>
          </div>
        ) : (
          <div
            ref={wrapperRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageDataUrl}
              alt={imageName ?? 'Flow diagram'}
              onLoad={handleImageLoad}
              // Tailwind's preflight resets every <img> to max-width:100%,
              // which caps this element's own layout width to its container
              // before our `scale()` transform (in the wrapper above) ever
              // runs — for a diagram wider than the viewport, that shrinks it
              // once via the CSS cap and a second time via our own zoom math,
              // compounding into a far-too-small, top-left-pinned result.
              // max-w-none removes the cap so our transform is the only thing
              // controlling size, matching what fitToFrame() actually computes.
              className="block max-w-none select-none"
              draggable={false}
            />

            {showConnections && connections && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                  <marker
                    id="connection-arrowhead"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="#7c3aed" />
                  </marker>
                </defs>
                {connections.map(({ from, to }, i) => {
                  const fromBox = boxes.find((b) => b.id === from);
                  const toBox = boxes.find((b) => b.id === to);
                  if (!fromBox || !toBox) return null;
                  const x1 = fromBox.x + fromBox.width / 2;
                  const y1 = fromBox.y + fromBox.height / 2;
                  const x2 = toBox.x + toBox.width / 2;
                  const y2 = toBox.y + toBox.height / 2;
                  return (
                    <line
                      key={`${from}-${to}-${i}`}
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                      stroke="#7c3aed"
                      strokeWidth={3}
                      markerEnd="url(#connection-arrowhead)"
                    />
                  );
                })}
              </svg>
            )}

            {boxes.map((box) => {
              const isActive = box.id === activeBoxId;
              return (
                <div key={box.id}>
                  <div
                    aria-hidden="true"
                    style={{
                      left: `calc(${box.x}% - 8px)`,
                      top: `calc(${box.y}% - 8px)`,
                      width: `calc(${box.width}% + 16px)`,
                      height: `calc(${box.height}% + 16px)`,
                      opacity: isActive ? 1 : 0,
                      transition: 'opacity 100ms ease',
                    }}
                    className="pointer-events-none absolute border-[12px] border-ink"
                  />

                  <div
                    data-hotspot
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenEditor(box.id)}
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.width}%`,
                      height: `${box.height}%`,
                    }}
                    className="absolute cursor-pointer border-[6px] border-dashed border-ink/70 bg-ink/0 transition-colors duration-100 hover:bg-ink/10"
                  >
                    <div
                      onPointerDown={(e) => startDrag(e, box, 'resize')}
                      className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize border border-paper bg-ink"
                    />
                  </div>

                  <div
                    data-hotspot
                    style={{
                      left: `${box.x}%`,
                      top: `calc(${box.y}% - 120px)`,
                    }}
                    className="absolute flex items-center gap-4 border-2 border-ink bg-paper px-4 py-2"
                  >
                    <span
                      onPointerDown={(e) => startDrag(e, box, 'move')}
                      className="cursor-grab select-none px-2 font-label text-[44px] text-muted-ink active:cursor-grabbing"
                      title="Drag to move"
                    >
                      ⋮⋮
                    </span>
                    <input
                      value={box.label}
                      onChange={(e) => renameBox(box.id, e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="w-[448px] border-none bg-transparent font-label text-[44px] text-ink outline-none"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBox(box.id);
                      }}
                      className="px-2 font-label text-[48px] text-muted-ink transition-colors duration-100 hover:text-ink"
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
