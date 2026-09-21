'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import { detectBlueHotspots, annotateWithMarkers } from '@/lib/detectHotspots';
import { buttonIcon, buttonOutline, buttonPrimary } from '@/lib/styles';

type Props = {
  imageDataUrl: string | null;
  imageName: string | null;
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  anthropicApiKey: string;
  onImageChange: (dataUrl: string, name: string) => void;
  onBoxesChange: (boxes: PlaybookBox[]) => void;
  onSelectBox: (id: string) => void;
  onOpenEditor: (id: string) => void;
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
  onImageChange,
  onBoxesChange,
  onSelectBox,
  onOpenEditor,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
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
  // viewport — the "frame the PNG within the frame" reset.
  const fitToFrame = useCallback(() => {
    const viewport = viewportRef.current;
    const natural = naturalSizeRef.current;
    if (!viewport || !natural || natural.width === 0 || natural.height === 0) return;
    const rect = viewport.getBoundingClientRect();
    const scale = clamp(Math.min(rect.width / natural.width, rect.height / natural.height), MIN_SCALE, MAX_SCALE);
    setView({
      scale,
      x: (rect.width - natural.width * scale) / 2,
      y: (rect.height - natural.height * scale) / 2,
    });
  }, []);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    naturalSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
    fitToFrame();
  };

  // Zoom by `factor`, keeping the given viewport-relative point fixed on
  // screen (cursor for wheel/pinch, viewport center for the +/- buttons) —
  // the same "zoom toward what you're pointing at" feel as Figma.
  const zoomBy = useCallback((factor: number, center?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
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
        <button onClick={addBox} disabled={!imageDataUrl} className={buttonOutline}>
          + Add playbook box
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
            <button onClick={fitToFrame} className={buttonOutline} title="Fit the image back within the frame">
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
        className={`relative h-[560px] touch-none overflow-hidden border-2 border-dashed p-3 transition-colors duration-100 ${
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
              className="block select-none"
              draggable={false}
            />

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
                    className="pointer-events-none absolute border-4 border-ink"
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
                    className="absolute cursor-pointer border-2 border-dashed border-ink/70 bg-ink/0 transition-colors duration-100 hover:bg-ink/10"
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
                      top: `calc(${box.y}% - 30px)`,
                    }}
                    className="absolute flex items-center gap-1 border-2 border-ink bg-paper px-1 py-0.5"
                  >
                    <span
                      onPointerDown={(e) => startDrag(e, box, 'move')}
                      className="cursor-grab select-none px-0.5 font-label text-[11px] text-muted-ink active:cursor-grabbing"
                      title="Drag to move"
                    >
                      ⋮⋮
                    </span>
                    <input
                      value={box.label}
                      onChange={(e) => renameBox(box.id, e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="w-28 border-none bg-transparent font-label text-[11px] text-ink outline-none"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBox(box.id);
                      }}
                      className="px-0.5 font-label text-xs text-muted-ink transition-colors duration-100 hover:text-ink"
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
