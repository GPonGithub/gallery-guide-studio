'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { LAYOUT_SIZE, PROJECTION_SHAPES, ROOM_DRAWING, type ProjectionShape } from '@/lib/agent/projectionLayout';
import { dropUnbacked, hideArea, useShowing, type Shown } from '@/lib/agent/mediaShow';
import type { MediaAsset } from '@/lib/agent/media';
import {
  allowed,
  areaOfTrack,
  currentMediaLinks,
  DRAG_VISUAL,
  loadLibrary,
  mediaSceneKey,
  openMediaFile,
  savedMediaFolder,
  useMediaLinks,
  type DraggedAsset,
  type Placement,
} from '@/lib/agent/mediaFolder';
import { replayMarker, useMarkerStage } from '@/lib/agent/markerPlay';
import {
  areaAt,
  boxOfShape,
  dropOnArea,
  placedBars,
  placingAt,
  removePlacement,
  setPlacement,
  setPlacing,
  toggleArea,
  usePlacing,
} from '@/lib/agent/roomPlacement';
import { buttonOutline } from '@/lib/styles';
import { MediaTimeline, type TimelineStage } from './MediaTimeline';
import { SceneButtons } from './SceneButtons';
import { fieldLabel } from '@/lib/styles';

/**
 * The middle panel, open while "Adding Immersive Media Process" is: the
 * room's 11 projection areas on top, the timeline below, and a border
 * between them that drags up and down (double-click to reset; with it
 * focused, ↑ and ↓ move it). Its right-hand border, beside the chat, drags
 * sideways the same way. Where both borders sit is remembered. Each border
 * shows as a 4px black line, green (as Saved) while it's held.
 */

const SPLIT_KEY = 'media-workspace-split';
const SPLIT = { min: 0.15, standard: 0.4, max: 0.85, step: 0.05 } as const;
const clampSplit = (f: number) => Math.min(SPLIT.max, Math.max(SPLIT.min, f));

const CHAT_KEY = 'media-chat-width';
/** The chat's width beside the media panel. */
export const CHAT_WIDTH = { min: 300, standard: 380, step: 20, reopen: 400 } as const;
/** Dragged narrower than this (the border pulled all the way right), the chat folds away to a tab under the Inspector. */
export const CHAT_FOLD_BELOW = 150;
const CHAT_HIDDEN_KEY = 'media-chat-hidden';

export function loadChatHidden(): boolean {
  try {
    return window.localStorage.getItem(CHAT_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveChatHidden(hidden: boolean) {
  try {
    window.localStorage.setItem(CHAT_HIDDEN_KEY, String(hidden));
  } catch {
    // Storage blocked — it just won't be remembered.
  }
}
/** The media panel keeps at least this much room. */
const MEDIA_MIN = 320;

/** Within the limits: the chat at least its minimum, and the media panel never squeezed below its own. */
export function clampChatWidth(width: number, designWidth: number): number {
  const most = typeof window === 'undefined' ? 900 : window.innerWidth - designWidth - MEDIA_MIN;
  return Math.round(Math.max(CHAT_WIDTH.min, Math.min(width, most)));
}

export function loadChatWidth(): number {
  try {
    return Number(window.localStorage.getItem(CHAT_KEY)) || CHAT_WIDTH.standard;
  } catch {
    return CHAT_WIDTH.standard;
  }
}

export function saveChatWidth(width: number) {
  try {
    window.localStorage.setItem(CHAT_KEY, String(width));
  } catch {
    // Storage blocked — the width just won't be remembered.
  }
}

export function MediaWorkspace({
  chatWidth,
  onChatResize,
  scenes,
  currentSceneId,
  onSwitchScene,
  switching,
  sceneKey,
  sceneTitle,
  stages,
  liveStage,
  scene,
}: {
  chatWidth: number;
  onChatResize: (width: number) => void;
  /** The sheet's scenes, as buttons above the room — the timeline is the open scene's. */
  scenes: { id: string; number: string; name: string }[];
  currentSceneId: string | null;
  onSwitchScene: (id: string) => void;
  /** The scene buttons wait while the conversation is busy. */
  switching: boolean;
  /** Which scene's timeline to show, and its title ("Scene 3 · Check in…"). */
  sceneKey: string;
  sceneTitle: string;
  /** The open scene's conversation stages, in order: the timeline's columns. */
  stages: TimelineStage[];
  /** The stage the conversation is in now (the playhead follows it). */
  liveStage?: string;
  /** The open scene in the sheet, whose media actions' connections are the timeline's bars. */
  scene: { sheetId: string; number: string } | null;
}) {
  const [split, setSplit] = useState<number>(SPLIT.standard);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [grabbed, setGrabbed] = useState(false);
  const release = () => {
    dragging.current = false;
    setGrabbed(false);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  };

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(SPLIT_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (stored) setSplit(clampSplit(stored));
    } catch {
      // Storage blocked: the standard split.
    }
  }, []);

  const resize = (f: number) => {
    const next = clampSplit(f);
    setSplit(next);
    try {
      window.localStorage.setItem(SPLIT_KEY, String(next));
    } catch {
      // As above.
    }
  };

  const fromPointer = (clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.height > 0) resize((clientY - r.top) / r.height);
  };

  return (
    <section
      ref={box}
      className="relative flex min-h-[640px] min-w-0 flex-col border-b-2 border-ink lg:min-h-0 lg:border-b-0 lg:border-r-2"
      aria-label="Immersive media"
    >
      <ChatBorder width={chatWidth} onResize={onChatResize} />
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden p-4" style={{ height: `${split * 100}%` }}>
        {scenes.length > 0 && (
          // Three columns: the buttons sit in the exact centre whatever the scene's name.
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <span className={`justify-self-end ${fieldLabel}`}>Scene</span>
            <SceneButtons
              scenes={scenes}
              currentId={currentSceneId}
              onSwitch={onSwitchScene}
              disabled={switching}
              label="Switch scene (the timeline is the open scene's)"
            />
            <span className="min-w-0 truncate font-body text-sm text-ink" title={sceneTitle}>
              {scenes.find((s) => s.id === currentSceneId)?.name ?? ''}
            </span>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ProjectionDiagram scene={scene} stages={stages} sceneTitle={sceneTitle} />
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the projection diagram and the timeline"
        aria-valuemin={Math.round(SPLIT.min * 100)}
        aria-valuemax={Math.round(SPLIT.max * 100)}
        aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Not a real pointer — following still works on the handle.
          }
          dragging.current = true;
          setGrabbed(true);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'row-resize';
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={() => resize(SPLIT.standard)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            resize(split + (e.key === 'ArrowDown' ? SPLIT.step : -SPLIT.step));
          } else if (e.key === 'Home' || e.key === 'Enter') {
            e.preventDefault();
            resize(SPLIT.standard);
          }
        }}
        className="group relative z-10 flex h-[10px] shrink-0 cursor-row-resize items-center outline-none"
      >
        <span className={`h-[4px] w-full transition-colors ${grabbed ? 'bg-[#15803d]' : 'bg-ink'}`} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-2">
        <MediaTimeline sceneKey={sceneKey} sceneTitle={sceneTitle} stages={stages} liveStage={liveStage} scene={scene} />
      </div>
    </section>
  );
}

/** The border between the media panel and the chat: dragging it right narrows the chat. */
function ChatBorder({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [grabbed, setGrabbed] = useState(false);
  const stop = () => {
    drag.current = null;
    setGrabbed(false);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat beside the media panel"
      aria-valuemin={CHAT_WIDTH.min}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click for the standard width"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not a real pointer — following still works on the handle.
        }
        drag.current = { startX: e.clientX, startWidth: width };
        setGrabbed(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.startWidth - (e.clientX - drag.current.startX));
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => onResize(CHAT_WIDTH.standard)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(width + (e.key === 'ArrowLeft' ? CHAT_WIDTH.step : -CHAT_WIDTH.step));
        } else if (e.key === 'Home' || e.key === 'Enter') {
          e.preventDefault();
          onResize(CHAT_WIDTH.standard);
        }
      }}
      // Sits over the panel's 2px right border, a little wider so it's easy to grab.
      className="group absolute inset-y-0 -right-[6px] z-20 hidden w-[10px] cursor-col-resize justify-center outline-none lg:flex"
    >
      <span className={`h-full w-[4px] transition-colors ${grabbed ? 'bg-[#15803d]' : 'bg-ink'}`} />
    </div>
  );
}

/** The room drawing with its 11 projection areas over it, drawn to fit the space it's given. */
/** The outlines' weight in the drawing's own units (as in the source file): it thins and thickens with the drawing. */
const OUTLINE_WEIGHT = 4;

const pointsOf = (s: ProjectionShape) => s.points.map((p) => p.join(',')).join(' ');
const pathOf = (points: [number, number][]) => `M${points.map((p) => p.join(',')).join('L')}Z`;
const SHAPES = new Map(PROJECTION_SHAPES.map((s) => [s.area, s]));

/** An area's outline, less any areas inside it (2, 5 and 8 have holes): what its media is cut to. */
const clipOf = (s: ProjectionShape) => [s.points, ...(s.holes ?? []).map((h) => SHAPES.get(h)!.points)].map(pathOf).join(' ');

type View = { x: number; y: number; w: number; h: number };
const FULL_VIEW: View = { x: 0, y: 0, w: LAYOUT_SIZE.width, h: LAYOUT_SIZE.height };
/** How far in the drawing zooms (scroll or pinch over it). */
const MAX_ZOOM = 8;
/** The picture outside the areas it's on, while placing it. */
const OUTSIDE_OPACITY = 0.25;
const SMALLEST = 12;

type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | 'rotate';
type Gesture = {
  kind: 'move' | 'handle' | 'pan';
  handle?: Handle;
  start: { x: number; y: number };
  client: { x: number; y: number };
  place?: Placement;
  view: View;
  moved: boolean;
};

/** A placed item's file (an object URL), opened from the scene's own media folder. */
function usePlacedFile(sceneKey: string | null, assetId: string | null) {
  const [found, setFound] = useState<{ asset: MediaAsset; url: string; key: string } | null>(null);
  const key = `${sceneKey}|${assetId}`;
  useEffect(() => {
    if (!sceneKey || !assetId) return;
    let gone = false;
    let made = '';
    void (async () => {
      const asset = (await loadLibrary(sceneKey))?.assets.find((a) => a.id === assetId);
      if (!asset || gone) return;
      let url = '';
      if (asset.kind === 'image' || asset.kind === 'video') {
        const folder = await savedMediaFolder(sceneKey);
        if (folder && (await allowed(folder, false).catch(() => false))) {
          const file = await openMediaFile(folder, asset.path).catch(() => null);
          if (file && !gone) url = made = URL.createObjectURL(file);
        }
      }
      if (!gone) setFound({ asset, url, key });
    })();
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sceneKey, assetId, key]);
  return found?.key === key ? found : null;
}

/** A picture, video, colour or text drawn at its placement (centre, size, turn) — stretched to it. */
function PlacedPicture({
  kind,
  url,
  value,
  place,
  clip,
  mask,
  opacity = 1,
  onVideoError,
}: {
  kind: MediaAsset['kind'];
  url: string;
  value?: string;
  place: Placement;
  clip?: string;
  /** Shown only through these areas (a mask from AreasMask). */
  mask?: string;
  opacity?: number;
  /** A video Chrome can't play. */
  onVideoError?: () => void;
}) {
  const at = { x: -place.w / 2, y: -place.h / 2, width: place.w, height: place.h };
  let body: React.ReactNode = null;
  if (kind === 'color') body = <rect {...at} fill={value || '#000'} />;
  else if (kind === 'text')
    body = (
      <>
        <rect {...at} fill="#000" />
        <foreignObject {...at}>
          <div style={textStyle(place.w, place.h)}>{value}</div>
        </foreignObject>
      </>
    );
  else if (kind === 'image' && url)
    body = (
      <image
        href={url}
        {...at}
        preserveAspectRatio="none"
      />
    );
  else if (kind === 'video' && url)
    body = (
      <foreignObject {...at}>
        <video
          src={url}
          autoPlay
          muted
          loop
          playsInline
          onError={onVideoError}
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
      </foreignObject>
    );
  else body = <rect {...at} fill="#3c5eac" opacity={0.35} />;
  return (
    <g clipPath={clip} mask={mask} opacity={opacity} style={{ pointerEvents: 'none' }}>
      <g transform={`translate(${place.cx} ${place.cy}) rotate(${place.rot})`}>{body}</g>
    </g>
  );
}

const textStyle = (w: number, h: number): CSSProperties => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8%',
  color: '#fff',
  textAlign: 'center',
  lineHeight: 1.2,
  fontSize: Math.min(h / 6, w / 9),
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
});

function ProjectionDiagram({
  scene,
  stages,
  sceneTitle,
}: {
  scene: { sheetId: string; number: string } | null;
  stages: TimelineStage[];
  sceneTitle: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [pixels, setPixels] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(FULL_VIEW);
  const showing = useShowing();
  const links = useMediaLinks();
  const placing = usePlacing();
  const marker = useMarkerStage();
  const order = stages.map((s) => s.code);
  const sceneKey = scene ? mediaSceneKey(scene) : null;
  const ours = Boolean(placing && scene && placing.sheetId === scene.sheetId && placing.sceneNumber === scene.number);
  const group = placing && ours ? placedBars(links, placing) : null;
  const placed = usePlacedFile(sceneKey, group ? placing!.assetId : null);
  // While dragging a handle, the picture follows the pointer here; it's saved (one undo step) on letting go.
  const [draft, setDraft] = useState<Placement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Placing something that's gone (undone, deleted, connected to an action, another scene): stop placing.
  useEffect(() => {
    if (placing && !group) setPlacing(null);
  }, [placing, group]);
  useEffect(() => {
    if (!placing) return;
    // Return (or Escape) lets go of the picture: it settles into the scene, as Done does. Delete (or
    // Backspace) deletes it.
    const esc = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (e.key === 'Escape') setPlacing(null);
      else if (e.key === 'Enter' && !typing && !t?.closest?.('button')) setPlacing(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        e.preventDefault();
        removePlacement(placing);
        dropUnbacked(currentMediaLinks());
        void replayMarker();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [placing]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPixels({ width: r.width, height: r.height });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // How many drawing units one screen pixel is ("meet": whichever of width or height is tighter) — so
  // outlines and handles keep their size on screen however far it's zoomed.
  const unitsPerPixel = pixels.width ? Math.max(view.w / pixels.width, view.h / pixels.height) : 1;
  const weight = Math.max(OUTLINE_WEIGHT * (view.w / FULL_VIEW.w), unitsPerPixel);

  /** A screen point, in the drawing's units. */
  const toDrawing = (clientX: number, clientY: number) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  // Scroll (or pinch) over the drawing zooms it around the pointer.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = el.getScreenCTM();
      if (!m) return;
      const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      setView((v) => {
        const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const w = Math.min(FULL_VIEW.w, Math.max(FULL_VIEW.w / MAX_ZOOM, v.w * factor));
        const k = w / v.w;
        const h = v.h * k;
        if (w >= FULL_VIEW.w) return FULL_VIEW;
        return { x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k, w, h };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const place = draft ?? group?.bars[0].place ?? null;
  const onAreas = new Set(group?.bars.flatMap((b) => areaOfTrack(b.track) ?? []) ?? []);

  // --- dropping a Media Library item on an area ---
  const dragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_VISUAL) || !scene || !stages.length) return;
    const p = toDrawing(e.clientX, e.clientY);
    const area = areaAt(p.x, p.y);
    if (area !== null) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
    if (area !== hover) setHover(area);
  };
  const drop = (e: React.DragEvent) => {
    setHover(null);
    const raw = e.dataTransfer.getData(DRAG_VISUAL);
    if (!raw || !scene || !stages.length) return;
    const p = toDrawing(e.clientX, e.clientY);
    const area = areaAt(p.x, p.y);
    if (area === null) return;
    e.preventDefault();
    let item: DraggedAsset;
    try {
      item = JSON.parse(raw) as DraggedAsset;
    } catch {
      return;
    }
    const stage = marker && order.includes(marker) ? marker : order[0];
    dropOnArea(item, area, stage, { ...scene, name: sceneTitle.replace(/^Scene\s+\S+\s+·\s+/, '') }, order);
    // The new picture replaces what was showing there (in the drawing and in TouchDesigner), and goes up.
    hideArea(area, item.id);
    void replayMarker();
  };

  // --- pointer: move the picture, its handles, pan, and click areas ---
  const begin = (e: ReactPointerEvent, kind: Gesture['kind'], handle?: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer (a scripted test) — moves still reach the drawing.
    }
    gesture.current = {
      kind,
      handle,
      start: toDrawing(e.clientX, e.clientY),
      client: { x: e.clientX, y: e.clientY },
      place: place ?? undefined,
      view,
      moved: false,
    };
  };
  const follow = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 4) return;
    g.moved = true;
    if (g.kind === 'pan') {
      if (g.view.w >= FULL_VIEW.w) return;
      const k = g.view.w / Math.max(1, pixels.width);
      setView({ ...g.view, x: g.view.x - (e.clientX - g.client.x) * k, y: g.view.y - (e.clientY - g.client.y) * k });
      return;
    }
    const s = g.place;
    if (!s) return;
    const p = toDrawing(e.clientX, e.clientY);
    if (g.kind === 'move') {
      setDraft({ ...s, cx: s.cx + p.x - g.start.x, cy: s.cy + p.y - g.start.y });
      return;
    }
    // The pointer in the picture's own frame (unturned, centred).
    const turn = (-s.rot * Math.PI) / 180;
    const dx = p.x - s.cx;
    const dy = p.y - s.cy;
    const lx = dx * Math.cos(turn) - dy * Math.sin(turn);
    const ly = dx * Math.sin(turn) + dy * Math.cos(turn);
    const h = g.handle!;
    if (h === 'rotate') {
      let rot = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      setDraft({ ...s, rot: ((rot % 360) + 360) % 360 });
      return;
    }
    // Which sides the handle pulls: the opposite edge (or corner) stays put — Option/Alt: from the centre.
    const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0;
    const sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
    const centred = e.altKey;
    const reach = (l: number, size: number, sign: number) =>
      Math.max(SMALLEST, centred ? 2 * Math.abs(l) : sign * l + size / 2);
    let w = sx ? reach(lx, s.w, sx) : s.w;
    let hh = sy ? reach(ly, s.h, sy) : s.h;
    if (sx && sy && !e.shiftKey) {
      // Corners keep the picture's proportions (Shift: free).
      const k = Math.max(w / s.w, hh / s.h);
      w = s.w * k;
      hh = s.h * k;
    }
    // The centre moves so the far edge stays where it was (in the picture's own, turned frame).
    const ox = centred || !sx ? 0 : (sx * (w - s.w)) / 2;
    const oy = centred || !sy ? 0 : (sy * (hh - s.h)) / 2;
    const r = (s.rot * Math.PI) / 180;
    setDraft({
      ...s,
      w,
      h: hh,
      cx: s.cx + ox * Math.cos(r) - oy * Math.sin(r),
      cy: s.cy + ox * Math.sin(r) + oy * Math.cos(r),
    });
  };
  const end = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      if (draft && placing) {
        setPlacement(placing, draft, g.kind === 'move' ? 'Move picture' : 'Resize picture');
        void replayMarker();
      }
      setDraft(null);
      return;
    }
    // A click: an area goes on or off while placing; otherwise the picture on it is picked up.
    const p = toDrawing(e.clientX, e.clientY);
    const area = areaAt(p.x, p.y);
    if (placing && group) {
      if (area === null) {
        setPlacing(null);
        return;
      }
      // Switched on: it replaces what was showing there. Switched off: it comes off that area too.
      hideArea(area, onAreas.has(area) ? undefined : placing.assetId);
      toggleArea(placing, area, order);
      void replayMarker();
      return;
    }
    if (area === null || !scene) return;
    const stage = marker && order.includes(marker) ? marker : order[0];
    const found = stage ? placingAt(links, scene, area, stage, order) : null;
    if (found) setPlacing(found);
  };

  const hs = 9 * unitsPerPixel;
  // What's showing that was placed on the drawing, by picture and placement: each drawn once over its areas.
  const placedGroups: { shown: Shown; areas: number[] }[] = [];
  for (const sh of showing) {
    if (!sh.place) continue;
    const same = placedGroups.find(
      (g) => g.shown.assetId === sh.assetId && JSON.stringify(g.shown.place) === JSON.stringify(sh.place),
    );
    if (same) same.areas.push(sh.area);
    else placedGroups.push({ shown: sh, areas: [sh.area] });
  }

  return (
    <div className="relative flex h-full w-full flex-col gap-1">
      <svg
        ref={svg}
        data-tour="room-diagram"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={`min-h-0 w-full flex-1 touch-none select-none ${view.w < FULL_VIEW.w ? 'cursor-grab' : ''}`}
        role="img"
        aria-label="The room's 11 projection areas — drop a picture or video on an area to place it"
        onDragOver={dragOver}
        onDragLeave={() => setHover(null)}
        onDrop={drop}
        onPointerDown={(e) => begin(e, 'pan')}
        onPointerMove={follow}
        onPointerUp={end}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
        }}
        onDoubleClick={() => setView(FULL_VIEW)}
      >
        <defs>
          {PROJECTION_SHAPES.map((s) => (
            <clipPath key={s.area} id={`projection-area-${s.area}`} clipPathUnits="userSpaceOnUse">
              <path d={clipOf(s)} clipRule="evenodd" />
            </clipPath>
          ))}
          {/* A placed picture's areas together: it's drawn once, through all of them (one video, not one per
              area). A mask, each outline painted on its own — a clip path made of several loses the holes
              (panel 6 inside wall 5) and would show the picture on the panels too. */}
          {placedGroups.map((g, i) => (
            <AreasMask key={i} id={`placed-group-${i}`} areas={g.areas} />
          ))}
          <AreasMask id="placing-areas" areas={[...onAreas]} />
        </defs>
        <image href={ROOM_DRAWING} x={0} y={0} width={LAYOUT_SIZE.width} height={LAYOUT_SIZE.height} />
        {PROJECTION_SHAPES.map((s) => {
          const shown = showing.find((m) => m.area === s.area);
          return (
            <g key={s.area}>
              {s.filled && <polygon points={pointsOf(s)} className="fill-paper" />}
              {shown && !shown.place && !(group && onAreas.has(s.area)) && <AreaMedia shape={s} shown={shown} />}
            </g>
          );
        })}
        {placedGroups.map((g, i) =>
          group && g.areas.some((a) => onAreas.has(a)) ? null : (
            <PlacedShown key={`${g.shown.assetId}-${i}`} shown={g.shown} mask={`url(#placed-group-${i})`} />
          ),
        )}
        {group && place && placed && (
          <g>
            {/* The whole picture, faint — then at full strength inside each area it's on. */}
            <PlacedPicture
              kind={placed.asset.kind}
              url={placed.url}
              value={placed.asset.value}
              place={place}
              opacity={OUTSIDE_OPACITY}
            />
            <PlacedPicture
              kind={placed.asset.kind}
              url={placed.url}
              value={placed.asset.value}
              place={place}
              mask="url(#placing-areas)"
            />
          </g>
        )}
        {PROJECTION_SHAPES.map((s) => {
          const shown = showing.find((m) => m.area === s.area);
          const on = onAreas.has(s.area);
          const lit = hover === s.area;
          return (
            <g key={s.area} style={{ pointerEvents: 'none' }}>
              <polygon
                points={pointsOf(s)}
                className={`fill-none ${lit ? 'stroke-[#15803d]' : on ? 'stroke-[#3c5eac]' : 'stroke-ink'}`}
                strokeWidth={lit || on ? weight * 2 : weight}
                strokeMiterlimit={10}
              />
              <text
                x={s.label[0]}
                y={s.label[1]}
                textAnchor="middle"
                dominantBaseline="central"
                // Over a picture, a white outline keeps the number readable.
                className={`fill-ink font-body ${shown || on ? 'stroke-paper' : ''}`}
                strokeWidth={shown || on ? 6 : 0}
                paintOrder="stroke"
                fontSize={s.small ? 28 : 46}
              >
                {s.area}
              </text>
            </g>
          );
        })}
        {group && place && (
          <g transform={`translate(${place.cx} ${place.cy}) rotate(${place.rot})`}>
            {/* Dragging inside the picture moves it (a click there toggles the area under it). */}
            <rect
              x={-place.w / 2}
              y={-place.h / 2}
              width={place.w}
              height={place.h}
              fill="transparent"
              stroke="#3c5eac"
              strokeWidth={1.5 * unitsPerPixel}
              strokeDasharray={`${6 * unitsPerPixel} ${4 * unitsPerPixel}`}
              className="cursor-move"
              onPointerDown={(e) => begin(e, 'move')}
            />
            <line
              x1={0}
              y1={-place.h / 2}
              x2={0}
              y2={-place.h / 2 - 28 * unitsPerPixel}
              stroke="#3c5eac"
              strokeWidth={1.5 * unitsPerPixel}
              style={{ pointerEvents: 'none' }}
            />
            {(
              [
                ['nw', -1, -1],
                ['ne', 1, -1],
                ['se', 1, 1],
                ['sw', -1, 1],
              ] as const
            ).map(([h, sx, sy]) => (
              <rect
                key={h}
                data-handle={h}
                x={(sx * place.w) / 2 - hs / 2}
                y={(sy * place.h) / 2 - hs / 2}
                width={hs}
                height={hs}
                className="fill-paper stroke-[#3c5eac]"
                strokeWidth={1.5 * unitsPerPixel}
                style={{ cursor: sx === sy ? 'nwse-resize' : 'nesw-resize' }}
                onPointerDown={(e) => begin(e, 'handle', h)}
              />
            ))}
            {(
              [
                ['n', 0, -1],
                ['s', 0, 1],
                ['e', 1, 0],
                ['w', -1, 0],
              ] as const
            ).map(([h, sx, sy]) => {
              const long = 2.2 * hs;
              const across = 0.8 * hs;
              const tw = sx ? across : long;
              const th = sx ? long : across;
              return (
                <rect
                  key={h}
                  data-handle={h}
                  x={(sx * place.w) / 2 - tw / 2}
                  y={(sy * place.h) / 2 - th / 2}
                  width={tw}
                  height={th}
                  className="fill-[#3c5eac] stroke-paper"
                  strokeWidth={unitsPerPixel}
                  style={{ cursor: sx ? 'ew-resize' : 'ns-resize' }}
                  onPointerDown={(e) => begin(e, 'handle', h)}
                />
              );
            })}
            <circle
              data-handle="rotate"
              cx={0}
              cy={-place.h / 2 - 28 * unitsPerPixel}
              r={hs * 0.65}
              className="fill-paper stroke-[#3c5eac]"
              strokeWidth={1.5 * unitsPerPixel}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => begin(e, 'handle', 'rotate')}
            />
          </g>
        )}
      </svg>
      {view.w < FULL_VIEW.w && (
        <button
          onClick={() => setView(FULL_VIEW)}
          className={`absolute bottom-1 right-1 ${buttonOutline} px-2 py-0.5 text-[10px]`}
          title="Show the whole room (or double-click the drawing)"
        >
          Whole room
        </button>
      )}
    </div>
  );
}

/** White where any of these areas are (each with its own holes), black elsewhere: a mask showing them. */
function AreasMask({ id, areas }: { id: string; areas: number[] }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={LAYOUT_SIZE.width} height={LAYOUT_SIZE.height}>
      {areas.map((a) => (
        <path key={a} d={clipOf(SHAPES.get(a)!)} fillRule="evenodd" fill="#fff" />
      ))}
    </mask>
  );
}

/** A placed picture or video that's showing, drawn once over all its areas (a video Chrome can't play: its first frame). */
function PlacedShown({ shown, mask }: { shown: Shown; mask: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const fallBack = shown.kind === 'video' && failed === shown.url;
  return (
    <g>
      <title>{`${shown.assetId} ${shown.name} — ${shown.action}`}</title>
      <PlacedPicture
        kind={fallBack ? 'image' : shown.kind}
        url={fallBack ? (shown.still ?? '') : shown.url}
        value={shown.value}
        place={shown.place!}
        mask={mask}
        onVideoError={() => setFailed(shown.url)}
      />
    </g>
  );
}

/**
 * An image or video in its area: filling the rectangle around the outline
 * (cropped, never stretched), then cut to the outline — so it fits areas
 * with a corner cut away (5, 10), and leaves the areas inside 2, 5 and 8
 * white (a picture placed on the drawing is drawn by PlacedShown). Video plays muted
 * (the room's sound is the sound track's), looping unless its connection says
 * to play once; one Chrome can't play shows its first frame, if ffmpeg made one.
 */
function AreaMedia({ shape, shown }: { shape: ProjectionShape; shown: Shown }) {
  const box = boxOfShape(shape);
  const [failed, setFailed] = useState<string | null>(null);
  const clip = `url(#projection-area-${shape.area})`;
  const title = <title>{`${shown.assetId} ${shown.name} — ${shown.action}`}</title>;
  // A colour fills the area; a text is white words on black, centred and sized to the area.
  if (shown.kind === 'color') {
    return (
      <rect {...box} fill={shown.value || '#000'} clipPath={clip}>
        {title}
      </rect>
    );
  }
  if (shown.kind === 'text') {
    return (
      <g>
        {title}
        <rect {...box} fill="#000" clipPath={clip} />
        <foreignObject {...box} clipPath={clip}>
          <div style={textStyle(box.width, box.height)}>{shown.value}</div>
        </foreignObject>
      </g>
    );
  }
  if (shown.kind === 'image' || failed === shown.url) {
    const href = shown.kind === 'image' ? shown.url : shown.still;
    if (!href) return null;
    return (
      <image href={href} {...box} preserveAspectRatio="xMidYMid slice" clipPath={clip}>
        {title}
      </image>
    );
  }
  // The title sits outside the foreignObject: inside it, it would be an HTML <title> and rename the page.
  return (
    <g>
      {title}
      <foreignObject {...box} clipPath={clip}>
        <video
          key={shown.url}
          src={shown.url}
          autoPlay
          muted
          playsInline
          loop={shown.loop}
          onError={() => setFailed(shown.url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </foreignObject>
    </g>
  );
}
