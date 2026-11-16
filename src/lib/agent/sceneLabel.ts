'use client';

import { useSyncExternalStore } from 'react';
import { PROJECTION_SHAPES } from './projectionLayout';
import { onTDReady, send, tdOutputSize } from './touchDesigner';

/**
 * The scene label on the wall: a small strip in the top-left corner of zone 1 · area 2 (area 13, the
 * right wall on projector 5). Left to right: a microphone symbol (green = the mic is listening, red and
 * crossed out = off), the scene's number and its title.
 *
 * It's drawn here as a see-through PNG the size of an area's picture and sent to TouchDesigner
 * ({"type":"label"}), which lays it over whatever media that area shows. Sent again only when it
 * changes, and each time TouchDesigner connects. Shown or hidden from section 4 (kept in this browser).
 */

export const LABEL_AREA = 13;
export type SceneLabel = { micOn: boolean; number: string; title: string };

const ON_KEY = 'scene-label-on';
let on = true;
let read = false;
const listeners = new Set<() => void>();

function isOn(): boolean {
  if (!read && typeof window !== 'undefined') {
    read = true;
    try {
      on = window.localStorage.getItem(ON_KEY) !== 'off';
    } catch {
      // shown
    }
  }
  return on;
}

export const useSceneLabelOn = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    isOn,
    () => true,
  );

export function setSceneLabelOn(next: boolean) {
  on = next;
  read = true;
  try {
    window.localStorage.setItem(ON_KEY, next ? 'on' : 'off');
  } catch {
    // for this page only
  }
  listeners.forEach((l) => l());
  push();
}

let wanted: SceneLabel | null = null;
/** What TouchDesigner has now ('' = don't know, e.g. just connected). */
let sentKey = '';

/** The label as it should be now (the page calls this whenever the mic or the scene changes). */
export function setSceneLabel(label: SceneLabel) {
  wanted = label;
  push();
}

if (typeof window !== 'undefined')
  onTDReady(() => {
    sentKey = '';
    push();
  });

function push() {
  if (!isOn()) {
    if (sentKey !== 'hidden' && send({ type: 'label', action: 'hide', area: LABEL_AREA })) sentKey = 'hidden';
    return;
  }
  if (!wanted) return;
  const size = tdOutputSize();
  const key = JSON.stringify([wanted, size]);
  if (key === sentKey) return;
  const png = drawLabel(wanted, size.width, size.height);
  if (png && send({ type: 'label', action: 'show', area: LABEL_AREA, png })) sentKey = key;
}

// --- drawing -------------------------------------------------------------------

/** The wall area 13 is projected on, in inches (Kantan squeezes the whole picture onto it). */
const WALL = PROJECTION_SHAPES.find((s) => s.area === LABEL_AREA)?.inches ?? [80.5, 59];

/*
 * Sizes on the wall, in tenths of an inch. Area 14 (the panel) starts 14.9 in below the wall's top,
 * so the strip (1.5 in down, 3.4 in tall) stays clear of it.
 */
const MARGIN = 15;
const HEIGHT = 34;
const PAD = 8;
const BADGE = 26;
const NUMBER_FONT = 22;
const TITLE_FONT = 19;
const GAP = 10;
const MAX_TITLE = 560;
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** The label as a PNG (base64, no data: prefix), width x height, see-through except the strip. */
export function drawLabel(label: SceneLabel, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // One unit = a tenth of an inch on the wall, across and down alike (the picture is stretched
  // differently each way to fit the wall, so this keeps letters and the round badge true).
  ctx.setTransform(width / WALL[0] / 10, 0, 0, height / WALL[1] / 10, 0, 0);
  ctx.textBaseline = 'middle';

  const number = label.number.trim();
  const title = label.title.trim();
  ctx.font = `700 ${NUMBER_FONT}px ${FONT}`;
  const numberW = number ? ctx.measureText(number).width : 0;
  ctx.font = `400 ${TITLE_FONT}px ${FONT}`;
  const shownTitle = fit(ctx, title, MAX_TITLE);
  const titleW = shownTitle ? ctx.measureText(shownTitle).width : 0;

  const x0 = MARGIN;
  const y0 = MARGIN;
  const mid = y0 + HEIGHT / 2;
  let w = PAD + BADGE;
  if (number) w += GAP + numberW;
  if (shownTitle) w += (number ? GAP * 1.6 : GAP) + titleW;
  w += PAD + 2;

  // The strip: dark and mostly solid, so it reads over any picture.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  roundRect(ctx, x0, y0, w, HEIGHT, HEIGHT / 2);
  ctx.fill();

  // The microphone badge.
  const cx = x0 + PAD + BADGE / 2;
  ctx.fillStyle = label.micOn ? '#16a34a' : '#b91c1c';
  ctx.beginPath();
  ctx.arc(cx, mid, BADGE / 2, 0, Math.PI * 2);
  ctx.fill();
  drawMic(ctx, cx, mid, label.micOn);

  let x = x0 + PAD + BADGE + GAP;
  ctx.fillStyle = '#ffffff';
  if (number) {
    ctx.font = `700 ${NUMBER_FONT}px ${FONT}`;
    ctx.fillText(number, x, mid + 1);
    x += numberW + GAP * 0.8;
    // A thin divider between the number and the title.
    if (shownTitle) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(x - 1, y0 + 9, 2, HEIGHT - 18);
      ctx.fillStyle = '#ffffff';
      x += GAP * 0.8;
    }
  }
  if (shownTitle) {
    ctx.font = `400 ${TITLE_FONT}px ${FONT}`;
    ctx.fillText(shownTitle, x, mid + 1);
  }
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** A white microphone centred on (cx, cy), about 16 units tall; crossed out when off. */
function drawMic(ctx: CanvasRenderingContext2D, cx: number, cy: number, micOn: boolean) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.8;
  // The head.
  roundRect(ctx, cx - 3.2, cy - 8.5, 6.4, 11, 3.2);
  ctx.fill();
  // The holder round its lower half, the stem and the foot.
  ctx.beginPath();
  ctx.arc(cx, cy - 1.5, 5.6, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4.1);
  ctx.lineTo(cx, cy + 7);
  ctx.moveTo(cx - 3.5, cy + 7.6);
  ctx.lineTo(cx + 3.5, cy + 7.6);
  ctx.stroke();
  if (!micOn) {
    // A slash, outlined in the badge's red so it cuts through the mic.
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 7.5);
    ctx.lineTo(cx + 7, cy + 7.5);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The text, cut short with "…" if it's wider than max (in the current font). */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
