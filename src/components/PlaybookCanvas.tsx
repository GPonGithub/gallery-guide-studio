'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import { detectBlueHotspots, annotateWithMarkers } from '@/lib/detectHotspots';
import { buttonDanger, buttonIcon, buttonOutline, buttonSuccess } from '@/lib/styles';
import { parseFigmaUrl } from '@/lib/figmaUrl';
import { parsePlaybookTitle } from '@/lib/playbookTitle';
import { VIRTUAL_CANVAS } from '@/lib/canvasLayout';
import { designerId } from '@/lib/designerId';
import { ConfirmDialog } from './ConfirmDialog';

// The one blue accent in the app, deliberately matching the FigJam
// template's own "OPEN PLAYBOOK EDITOR" button so the two surfaces read as
// the same tool. Oversized to match the rest of the on-canvas title chip,
// which is deliberately large so it stays legible at typical zoom-out
// levels on the scaled canvas.
const buttonFigmaBlue =
  'border-2 border-[#18a0fb] bg-[#18a0fb] px-4 py-2 font-label text-[24px] font-medium uppercase tracking-wide ' +
  'text-white transition-colors duration-100 hover:bg-[#0d8ce0]';

type Props = {
  imageDataUrl: string | null;
  imageName: string | null;
  imagePixelSize: { width: number; height: number } | null;
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  designerInitials: string;
  anthropicApiKey: string;
  figmaApiKey: string;
  figmaFileUrl: string;
  figmaWriteDirty: boolean;
  onImageChange: (dataUrl: string, name: string) => void;
  onImagePixelSizeChange: (size: { width: number; height: number }) => void;
  onBoxesChange: (boxes: PlaybookBox[]) => void;
  onOpenEditor: (id: string) => void;
  onClearImage: () => void;
  onFigmaFileUrlChange: (url: string) => void;
  onFigmaWriteDirtyChange: (dirty: boolean) => void;
};

// Figma's official Embed Kit 2.0 — a genuinely live, interactive FigJam
// surface. Kept dormant (no toolbar button reaches `viewMode: 'figma'`
// anymore, per the PNG-first restructure) rather than deleted, in case the
// live-reference view is wanted again — this exact feature has been added
// and removed more than once this session.
function toEmbedUrl(fileUrl: string): string | null {
  const match = /figma\.com\/board\/([0-9a-zA-Z]+)\/([^/?]+)/.exec(fileUrl);
  if (!match) return null;
  return `https://embed.figma.com/board/${match[1]}/${match[2]}?embed-host=share`;
}

type View = { scale: number; x: number; y: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `box-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PlaybookCanvas({
  imageDataUrl,
  imageName,
  imagePixelSize,
  boxes,
  activeBoxId,
  designerInitials,
  anthropicApiKey,
  figmaApiKey,
  figmaFileUrl,
  figmaWriteDirty,
  onImageChange,
  onImagePixelSizeChange,
  onBoxesChange,
  onOpenEditor,
  onClearImage,
  onFigmaFileUrlChange,
  onFigmaWriteDirtyChange,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [generateStepsStatus, setGenerateStepsStatus] = useState<'idle' | 'queued' | 'running'>('idle');
  const [updateFigmaStatus, setUpdateFigmaStatus] = useState<'idle' | 'queued' | 'running'>('idle');
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  // Dormant — no toolbar button calls either setter anymore (PNG-first
  // restructure), kept per the user's request rather than deleted, in
  // case the live-embed/connections views are wanted again.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [viewMode, setViewMode] = useState<'diagram' | 'figma'>('diagram');
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showConnections, setShowConnections] = useState(false);
  const dragState = useRef<{
    boxId: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origBox: PlaybookBox;
  } | null>(null);
  const panState = useRef<{ startX: number; startY: number; origin: View } | null>(null);
  // Both Generate Steps and Update FigJam file poll for up to 90s — long
  // enough that the `boxes` prop captured at click time could go stale
  // (e.g. the student edits a box while waiting). Kept fresh every render
  // so the eventual write starts from whatever's actually on screen when
  // the job finishes, not a snapshot from when the button was clicked.
  const boxesRef = useRef(boxes);
  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

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
    // Falls back to the last-known PNG pixel size (kept even after "Clear
    // PNG" removes the image itself, so boxes stay positioned correctly),
    // then the generic virtual canvas if nothing's ever been uploaded.
    const natural = naturalSizeRef.current ?? imagePixelSize ?? VIRTUAL_CANVAS;
    if (!viewport || natural.width === 0 || natural.height === 0) return;
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
  }, [imagePixelSize]);

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

  // No image ever fires a load event to trigger the initial fit — do it
  // ourselves the first time boxes show up with nothing underneath them
  // (e.g. after Clear PNG, or a fresh Detect Blue Buttons pass).
  useEffect(() => {
    if (imageDataUrl || boxes.length === 0 || hasInteractedRef.current) return;
    fitToFrame();
  }, [imageDataUrl, boxes.length, imagePixelSize, fitToFrame]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    naturalSizeRef.current = size;
    onImagePixelSizeChange(size);
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
    if (!viewport || (!imageDataUrl && boxes.length === 0)) return;

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
  }, [imageDataUrl, boxes.length, zoomBy]);

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

  // Only clears the image itself — the point of "Clear PNG" is to declutter
  // the view while keeping detected boxes exactly where they are, which is
  // why `imagePixelSize` (the reference frame their positions are
  // percentages of) deliberately does NOT get cleared here.
  const clearPng = () => {
    if (!imageDataUrl) return;
    const proceed = window.confirm('This removes the uploaded image. Playbook boxes stay where they are.');
    if (!proceed) return;
    naturalSizeRef.current = null;
    onClearImage();
    // The boxes' edited content isn't going anywhere, but the point of
    // Clear PNG is a fresh start on the visual — leaving "Update FigJam
    // file" primed to fire on a canvas the student just wiped would be
    // more confusing than useful.
    onFigmaWriteDirtyChange(false);
  };

  // Clears the detected-button overlay only — the PNG itself (and its
  // `imagePixelSize` reference frame) is untouched, mirroring clearPng's
  // one-thing-at-a-time scope in the other direction.
  const clearBlueButtons = () => {
    if (boxes.length === 0) return;
    const proceed = window.confirm('This removes every detected blue button and its playbook steps. The image stays.');
    if (!proceed) return;
    onBoxesChange([]);
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

  // Step one of the workflow — records which board Generate Steps in
  // FigJam and Detect Blue Buttons act against, without fetching anything.
  const connectFigma = () => {
    const url = window.prompt('Paste the FigJam board URL to connect:', figmaFileUrl || '');
    if (!url) return;
    if (!figmaApiKey.trim()) {
      window.alert('Add a Figma personal access token under "API keys" too — reading real content needs it.');
    }
    onFigmaFileUrlChange(url);
  };

  type FigmaSyncResult = { boxes: PlaybookBox[]; boardExtent: { width: number; height: number } };

  // Pulls every real playbook's structured content (steps, instruction
  // prompt, figmaSourceId, leadsTo) straight from the board. Position/
  // boardExtent in the response are ignored by every caller now — Detect
  // Blue Buttons positions boxes from the PNG, not Figma geometry.
  const fetchFigmaBoxes = async (): Promise<FigmaSyncResult | null> => {
    if (!figmaFileUrl) {
      window.alert('Connect a Figma file first.');
      return null;
    }
    if (!figmaApiKey.trim()) {
      window.alert('Add a Figma personal access token under "API keys" first.');
      return null;
    }
    const res = await fetch('/api/sync-figma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl: figmaFileUrl, figmaApiKey }),
    });
    const data = (await res.json()) as Partial<FigmaSyncResult> & { error?: string };
    if (!res.ok || data.error || !data.boxes || !data.boardExtent) {
      window.alert(data.error ?? 'Could not read the connected FigJam file.');
      return null;
    }
    return { boxes: data.boxes, boardExtent: data.boardExtent };
  };

  // Computer-vision pass over an uploaded PNG: find each blue button's
  // pixel rect, ask a vision model to read the printed label above each one
  // (via a numbered-marker annotation, so it can't confuse two nearby
  // buttons) — then, if a FigJam file is connected, pull every real
  // playbook's actual content and match it to a detected button by its
  // label, so the resulting box opens to a real, populated editor instead
  // of an empty one. Unmatched buttons (or no Figma connection at all)
  // still get created with just their detected position/title, same as
  // the original PNG-only behavior.
  const detectBlueButtons = async () => {
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
      let detectionError: string | null = null;
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
          detectionError = data.error || `Server returned ${res.status}.`;
        }
      } catch (err) {
        detectionError = err instanceof Error ? err.message : 'Network error.';
      }

      if (detectionError) {
        window.alert(
          `Couldn't read the playbook names printed in the image: ${detectionError}\n\n` +
          'Check your Anthropic API key under "API keys", then try again. The boxes were still positioned ' +
          'correctly — rename each one by hand for now.',
        );
      }

      // Optional real-content pull, matched by title. Silent no-op if
      // Figma isn't connected — position+title-only detection still works.
      let realByLabel: Map<string, PlaybookBox> | null = null;
      if (figmaFileUrl && figmaApiKey.trim()) {
        const fresh = await fetchFigmaBoxes().catch(() => null);
        if (fresh) {
          realByLabel = new Map(fresh.boxes.map((b) => [b.label.trim().toLowerCase(), b]));
        }
      }

      let matchedCount = 0;
      const newBoxes: PlaybookBox[] = rects.map((r, i) => {
        // The vision model is asked to read the whole printed title, which
        // on a real board is "PLAYBOOK <code>: <label>" — strip that prefix
        // with the same pattern Figma-side parsing uses, so the label half
        // matches what sync-figma stores (just "Welcome", not "Playbook 1:
        // Welcome"). A card that doesn't follow the pattern (or wasn't read
        // at all) falls back to the raw text, then a generic placeholder.
        const rawLabel = labels[i]?.trim() || '';
        const parsedTitle = rawLabel ? parsePlaybookTitle(rawLabel) : null;
        const detectedLabel = parsedTitle?.label || rawLabel || `Untitled box ${i + 1}`;
        const real = realByLabel?.get(detectedLabel.trim().toLowerCase());
        if (real) {
          matchedCount += 1;
          // Reuse the real box's own id (not a fresh random one) so
          // navTarget/leadsTo cross-references between newly created boxes
          // stay internally consistent — a NAV step's target is another
          // box's id, and that other box is also being created right now
          // from this same detection pass.
          return {
            ...real,
            label: detectedLabel,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          };
        }
        return {
          id: makeId(),
          label: detectedLabel,
          // Even unmatched, the code actually printed on the card beats an
          // arbitrary detection-order fallback number.
          code: parsedTitle?.code ?? '',
          instructionPrompt: '',
          steps: [],
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      });

      onBoxesChange(newBoxes);

      if (realByLabel && matchedCount < rects.length) {
        window.alert(
          `Detected ${rects.length} button${rects.length === 1 ? '' : 's'}. Matched ${matchedCount} to real ` +
          `Figma content; the rest have no match — check the connected file or that titles match exactly.`,
        );
      }
    } catch {
      window.alert('Auto-detect failed. Try a different image.');
    } finally {
      setIsDetecting(false);
    }
  };

  // Queues a job the FigJam plugin's UI picks up next time it polls (while
  // its panel is open in Figma — see figjam-plugin/ui.html) to grow/
  // populate the connected board's step tables. Only writes into Figma —
  // does not touch `boxes` here, since box positioning now comes entirely
  // from Detect Blue Buttons (PNG pixels), a different coordinate system
  // than Figma board geometry. Upload a PNG of the updated board and run
  // Detect Blue Buttons afterward to bring the new content into the app.
  const generateStepsInFigma = async () => {
    if (!figmaFileUrl) {
      window.alert('Connect a Figma file first.');
      return;
    }
    if (!parseFigmaUrl(figmaFileUrl)) {
      window.alert("Couldn't recognize the connected URL as a Figma board — reconnect with the board's own URL.");
      return;
    }

    setGenerateStepsStatus('queued');
    try {
      const createRes = await fetch('/api/figma-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'generate' }),
      });
      const createData = (await createRes.json()) as { id?: string; error?: string };
      if (!createRes.ok || !createData.id) {
        window.alert(createData.error ?? 'Could not queue the request.');
        return;
      }
      const jobId = createData.id;

      const POLL_INTERVAL_MS = 2000;
      const TIMEOUT_MS = 90000;
      const deadline = Date.now() + TIMEOUT_MS;
      let sawRunning = false;

      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const statusRes = await fetch(`/api/figma-jobs/${jobId}`);
        if (!statusRes.ok) continue;
        const statusData = (await statusRes.json()) as {
          job?: { status: 'pending' | 'running' | 'done' | 'error'; log: string[] };
        };
        const job = statusData.job;
        if (!job) continue;

        if (job.status === 'running') {
          sawRunning = true;
          setGenerateStepsStatus('running');
        } else if (job.status === 'done') {
          window.alert(
            'Steps written to your FigJam board. Upload a PNG and click "Detect Blue Buttons" to bring them into the app.',
          );
          return;
        } else if (job.status === 'error') {
          window.alert(`Generation failed in the plugin: ${job.log[job.log.length - 1] ?? 'unknown error'}`);
          return;
        }
      }

      window.alert(
        sawRunning
          ? 'Timed out waiting for the plugin to finish. Check the plugin panel in Figma.'
          : 'No response from the plugin — make sure the FigJam board is open in Figma with the plugin panel running, then try again.',
      );
    } catch {
      window.alert('Could not reach the local app server to queue the request.');
    } finally {
      setGenerateStepsStatus('idle');
    }
  };

  // Writes local edits back into the live board — the symmetrical
  // counterpart to Generate Steps, using the exact same plugin-relay
  // mechanism (same constraint: only works while the plugin panel is open
  // in Figma). Only boxes with a real `figmaSourceId` (i.e. matched to a
  // real Figma table by a previous Detect Blue Buttons pass) can be
  // written back — a box created purely from vision detection, never
  // matched to real content, has nowhere in Figma to write to.
  const updateFigmaFile = async () => {
    if (!figmaFileUrl) {
      window.alert('Connect a Figma file first.');
      return;
    }
    if (!parseFigmaUrl(figmaFileUrl)) {
      window.alert("Couldn't recognize the connected URL as a Figma board — reconnect with the board's own URL.");
      return;
    }

    const tables = boxesRef.current
      .filter((b) => b.figmaSourceId)
      .map((b) => {
        const displayCode = b.code || b.label;
        return {
          figmaSourceId: b.figmaSourceId,
          instructionPrompt: b.instructionPrompt,
          steps: b.steps.map((step, i) => ({
            option: step.option,
            instruction: step.instruction,
            variable: step.variable ?? '',
            designerId: designerId(designerInitials, displayCode, i + 1),
          })),
        };
      });

    if (tables.length === 0) {
      window.alert("Nothing to update — these playbooks aren't linked to a real Figma table yet.");
      return;
    }

    setUpdateFigmaStatus('queued');
    try {
      const createRes = await fetch('/api/figma-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'apply-edits', payload: { tables } }),
      });
      const createData = (await createRes.json()) as { id?: string; error?: string };
      if (!createRes.ok || !createData.id) {
        window.alert(createData.error ?? 'Could not queue the request.');
        return;
      }
      const jobId = createData.id;

      const POLL_INTERVAL_MS = 2000;
      const TIMEOUT_MS = 90000;
      const deadline = Date.now() + TIMEOUT_MS;
      let sawRunning = false;

      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const statusRes = await fetch(`/api/figma-jobs/${jobId}`);
        if (!statusRes.ok) continue;
        const statusData = (await statusRes.json()) as {
          job?: { status: 'pending' | 'running' | 'done' | 'error'; log: string[] };
        };
        const job = statusData.job;
        if (!job) continue;

        if (job.status === 'running') {
          sawRunning = true;
          setUpdateFigmaStatus('running');
        } else if (job.status === 'done') {
          onFigmaWriteDirtyChange(false);
          window.alert('Your changes have been written to the FigJam board.');
          return;
        } else if (job.status === 'error') {
          window.alert(`Update failed in the plugin: ${job.log[job.log.length - 1] ?? 'unknown error'}`);
          return;
        }
      }

      window.alert(
        sawRunning
          ? 'Timed out waiting for the plugin to finish. Check the plugin panel in Figma, then try again.'
          : 'No response from the plugin — make sure the FigJam board is open in Figma with the plugin panel running, then try again.',
      );
    } catch {
      window.alert('Could not reach the local app server to queue the request.');
    } finally {
      setUpdateFigmaStatus('idle');
      setUpdateConfirmOpen(false);
    }
  };

  // Real connector arrows from the FigJam board (see `leadsTo` in
  // sync-figma/route.ts). Dormant — no toolbar button toggles
  // `showConnections` anymore, kept in case wanted again.
  const connections = boxes.flatMap((b) =>
    (b.leadsTo ?? [])
      .filter((to) => boxes.some((other) => other.id === to))
      .map((to) => ({ from: b.id, to })),
  );
  const connectionsVisible = showConnections && connections.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={connectFigma}
          className={buttonOutline}
          title="Set which FigJam board this canvas reads from — the first step"
        >
          Connect FigJam file
        </button>
        <button
          onClick={generateStepsInFigma}
          disabled={!figmaFileUrl || generateStepsStatus !== 'idle'}
          className={buttonOutline}
          title="Ask the FigJam plugin (must be open in Figma) to grow and populate the connected board's step tables"
        >
          {generateStepsStatus === 'idle' && 'Generate Steps in FigJam'}
          {generateStepsStatus === 'queued' && 'Queued…'}
          {generateStepsStatus === 'running' && 'Generating in Figma…'}
        </button>
        <button onClick={() => fileInputRef.current?.click()} className={buttonOutline}>
          {imageDataUrl ? 'Replace image' : 'Upload image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
        <button
          onClick={detectBlueButtons}
          disabled={!imageDataUrl || isDetecting}
          className={buttonOutline}
          title="Scan the uploaded image for blue buttons, and pull real content from the connected FigJam file where titles match"
        >
          {isDetecting ? 'Detecting…' : 'Detect Blue Buttons'}
        </button>
        <button
          onClick={() => setUpdateConfirmOpen(true)}
          disabled={!figmaWriteDirty || updateFigmaStatus !== 'idle'}
          className={figmaWriteDirty ? buttonSuccess : buttonOutline}
          title="Write your saved local edits back into the live FigJam board (the plugin must be open in Figma)"
        >
          {updateFigmaStatus === 'idle' && 'Update FigJam file'}
          {updateFigmaStatus === 'queued' && 'Queued…'}
          {updateFigmaStatus === 'running' && 'Writing to Figma…'}
        </button>
        <button
          onClick={clearPng}
          disabled={!imageDataUrl}
          className={buttonOutline}
          title="Remove the uploaded image — playbook boxes stay where they are"
        >
          Clear PNG
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

      {viewMode === 'figma' && figmaFileUrl && (
        <div className="relative h-[840px] overflow-hidden border-2 border-hair bg-muted">
          {toEmbedUrl(figmaFileUrl) ? (
            <iframe
              src={toEmbedUrl(figmaFileUrl) ?? undefined}
              className="h-full w-full border-0"
              allowFullScreen
              title="Live FigJam board"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-ink">
              <p className="font-display text-lg text-ink">Couldn&rsquo;t build an embed URL from the connected file</p>
              <p className="font-label text-[11px] uppercase tracking-widest">
                Expected a figma.com/board/… link — reconnect with the board&rsquo;s own URL.
              </p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'diagram' && (
      <div
        ref={viewportRef}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={handleDrop}
        onPointerDown={imageDataUrl || boxes.length > 0 ? handleBackgroundPointerDown : undefined}
        className={`relative h-[840px] touch-none overflow-hidden border-2 border-dashed p-3 transition-colors duration-100 ${
          isDraggingFile ? 'border-ink bg-ink text-paper' : 'border-hair bg-muted'
        } ${imageDataUrl || boxes.length > 0 ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {boxes.length > 0 && (
          <button
            data-hotspot
            onClick={clearBlueButtons}
            className={`absolute right-3 top-3 z-10 ${buttonDanger}`}
            title="Remove every detected blue button and its playbook steps — the image stays"
          >
            Clear Blue Buttons
          </button>
        )}
        {!imageDataUrl && boxes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-ink">
            <p className="font-display text-lg text-ink">Drop a flow diagram image here</p>
            <p className="font-label text-[11px] uppercase tracking-widest">
              or click &ldquo;Upload image&rdquo; above, then &ldquo;Detect Blue Buttons&rdquo;
            </p>
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
              ...(!imageDataUrl
                ? {
                    width: (imagePixelSize ?? VIRTUAL_CANVAS).width,
                    height: (imagePixelSize ?? VIRTUAL_CANVAS).height,
                  }
                : {}),
            }}
          >
            {!imageDataUrl && (
              <p className="absolute -top-8 left-0 font-label text-[11px] uppercase tracking-widest text-muted-ink">
                No diagram image — boxes shown on a blank canvas
              </p>
            )}
            {imageDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
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
            )}

            {connectionsVisible && (
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

                  {/* Just a clickable/resizable overlay, deliberately with no
                      fill or content of its own — the real button graphic is
                      already in the underlying image at this exact spot, and
                      should read as designed in FigJam, not be covered up.
                      Full step content lives in the editor modal (click to
                      open), not crammed in here. */}
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
                    className="absolute cursor-pointer border-[3px] border-dashed border-ink/40 bg-transparent transition-colors duration-100 hover:border-ink hover:bg-ink/5"
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
                        onOpenEditor(box.id);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={buttonFigmaBlue}
                    >
                      Open playbook editor
                    </button>
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
      )}

      {updateConfirmOpen && (
        <ConfirmDialog
          title="Update FigJam file?"
          message="This writes your local changes into the live FigJam board. Requires the FigJam plugin to be open in Figma. This can't be undone."
          confirmLabel="Update"
          onConfirm={updateFigmaFile}
          onCancel={() => setUpdateConfirmOpen(false)}
        />
      )}
    </div>
  );
}
