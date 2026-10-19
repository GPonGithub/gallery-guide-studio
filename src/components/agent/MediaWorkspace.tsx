'use client';

import { useEffect, useRef, useState } from 'react';
import { LAYOUT_SIZE, PROJECTION_SHAPES, ROOM_DRAWING, type ProjectionShape } from '@/lib/agent/projectionLayout';
import { useShowing, type Shown } from '@/lib/agent/mediaShow';
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
          <ProjectionDiagram />
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

/** The rectangle around an area's outline: its media fills it (cropped to fit), then is cut to the outline. */
function boxOf(s: ProjectionShape) {
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function ProjectionDiagram() {
  // How many drawing units one screen pixel is — so however small the drawing gets, its outlines stay
  // at least a pixel wide.
  const svg = useRef<SVGSVGElement>(null);
  const [unitsPerPixel, setUnitsPerPixel] = useState(0);
  const showing = useShowing();
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // "meet": the drawing is scaled by whichever of width or height is tighter.
      setUnitsPerPixel(Math.max(LAYOUT_SIZE.width / r.width, LAYOUT_SIZE.height / r.height));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const weight = Math.max(OUTLINE_WEIGHT, unitsPerPixel);
  return (
    <svg
      ref={svg}
      data-tour="room-diagram"
      viewBox={`0 0 ${LAYOUT_SIZE.width} ${LAYOUT_SIZE.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="The room's 11 projection areas"
    >
      <defs>
        {PROJECTION_SHAPES.map((s) => (
          <clipPath key={s.area} id={`projection-area-${s.area}`} clipPathUnits="userSpaceOnUse">
            <path d={clipOf(s)} clipRule="evenodd" />
          </clipPath>
        ))}
      </defs>
      <image href={ROOM_DRAWING} x={0} y={0} width={LAYOUT_SIZE.width} height={LAYOUT_SIZE.height} />
      {PROJECTION_SHAPES.map((s) => {
        const shown = showing.find((m) => m.area === s.area);
        return (
          <g key={s.area}>
            {s.filled && <polygon points={pointsOf(s)} className="fill-paper" />}
            {shown && <AreaMedia shape={s} shown={shown} />}
            <polygon
              points={pointsOf(s)}
              className="fill-none stroke-ink"
              strokeWidth={weight}
              strokeMiterlimit={10}
            />
            <text
              x={s.label[0]}
              y={s.label[1]}
              textAnchor="middle"
              dominantBaseline="central"
              // Over a picture, a white outline keeps the number readable.
              className={`fill-ink font-body ${shown ? 'stroke-paper' : ''}`}
              strokeWidth={shown ? 6 : 0}
              paintOrder="stroke"
              fontSize={s.small ? 28 : 46}
            >
              {s.area}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * An image or video in its area: filling the rectangle around the outline
 * (cropped, never stretched), then cut to the outline — so it fits areas
 * with a corner cut away (5, 10), and leaves the areas inside 2, 5 and 8
 * white. Video plays muted (the room's sound is the sound track's), looping
 * unless its connection says to play once; one Chrome can't play shows its
 * first frame, if ffmpeg made one.
 */
function AreaMedia({ shape, shown }: { shape: ProjectionShape; shown: Shown }) {
  const box = boxOf(shape);
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
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8%',
              color: '#fff',
              textAlign: 'center',
              lineHeight: 1.2,
              fontSize: Math.min(box.height / 6, box.width / 9),
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
            }}
          >
            {shown.value}
          </div>
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
