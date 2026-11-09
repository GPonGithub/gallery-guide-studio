'use client';

import { useSyncExternalStore } from 'react';
import {
  areaOfTrack,
  barsOf,
  MARKER_ACTION,
  timingOf,
  updateMediaLinks,
  type DraggedAsset,
  type MediaLink,
  type Placement,
  type TimelineBar,
} from './mediaFolder';
import { PROJECTION_SHAPES, type ProjectionShape } from './projectionLayout';

/**
 * Placing pictures and video on the room drawing. A picture dropped on an area fills it; it can then
 * be moved, resized (corners), stretched (side tabs) and turned, and other areas switched on or off by
 * clicking them. Each area it's on is a bar on that area's timeline row, carrying the same placement
 * and stages — so the timeline and the drawing are always the same thing. Each area shows the part of
 * the picture inside its outline: one picture spread over several walls looks like one scene from
 * where the drawing is drawn (the room is projected live, so students judge it there).
 *
 * One picture per area at a time: a newly placed one replaces whatever else was on that area for
 * those stages. The same file can be placed more than once at a stage (dropped again on another area):
 * each copy is its own group of bars — the bars with the same placement — and is moved on its own.
 */

/**
 * The placed picture being edited: a connection, the stages its placed bars cover, and an area it's
 * on — which copy, when the file is placed more than once at those stages (no area: all of them).
 */
export type Placing = {
  sheetId: string;
  sceneNumber: string;
  assetId: string;
  action: string;
  from: string;
  to: string;
  area?: number;
};

let placing: Placing | null = null;
const listeners = new Set<() => void>();
export function setPlacing(next: Placing | null) {
  placing = next;
  listeners.forEach((l) => l());
}
export const usePlacing = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => placing,
    () => null,
  );

const SHAPES = new Map(PROJECTION_SHAPES.map((s) => [s.area, s]));

function inside([x, y]: [number, number], points: [number, number][]) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The area at a point of the drawing (a panel in front of a wall wins over the wall), or null. */
export function areaAt(x: number, y: number): number | null {
  const hits = PROJECTION_SHAPES.filter(
    (s) => inside([x, y], s.points) && !(s.holes ?? []).some((h) => inside([x, y], SHAPES.get(h)!.points)),
  );
  return hits.length ? hits.sort((a, b) => sizeOf(a) - sizeOf(b))[0].area : null;
}
const sizeOf = (s: ProjectionShape) => {
  const b = boxOfShape(s);
  return b.width * b.height;
};

/** The rectangle around an area's outline. */
export function boxOfShape(s: ProjectionShape) {
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A picture filling an area: the rectangle around its outline. */
export function fillArea(area: number): Placement {
  const b = boxOfShape(SHAPES.get(area)!);
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, rot: 0 };
}

/** Whether two placements are the same (one copy of a picture: its bars share one placement). */
export const samePlace = (a?: Placement, b?: Placement) =>
  Boolean(
    a &&
      b &&
      a.cx === b.cx &&
      a.cy === b.cy &&
      a.w === b.w &&
      a.h === b.h &&
      a.rot === b.rot &&
      JSON.stringify(a.pin ?? null) === JSON.stringify(b.pin ?? null),
  );

/** A connection's bars that make up the copy a Placing refers to: placed, over those stages, sharing its placement. */
function groupOf(link: MediaLink, p: Placing): TimelineBar[] {
  const stages = barsOf(link).filter((b) => b.place && b.from === p.from && b.to === p.to);
  if (p.area === undefined) return stages;
  const anchor = stages.find((b) => areaOfTrack(b.track) === p.area);
  return anchor ? stages.filter((b) => samePlace(b.place, anchor.place)) : [];
}

/** The placed bars a Placing refers to (its copy's bars). */
export function placedBars(links: MediaLink[], p: Placing): { link: MediaLink; bars: TimelineBar[] } | null {
  const link = links.find(
    (l) => l.sheetId === p.sheetId && l.sceneNumber === p.sceneNumber && l.assetId === p.assetId && l.action === p.action,
  );
  if (!link) return null;
  const bars = groupOf(link, p);
  return bars.length ? { link, bars } : null;
}

const sameLink = (a: MediaLink, b: { sheetId: string; sceneNumber: string; assetId: string; action: string }) =>
  a.sheetId === b.sheetId && a.sceneNumber === b.sceneNumber && a.assetId === b.assetId && a.action === b.action;

/** A connection with its bars replaced. A connection left with no bars goes (null). */
function withBars(link: MediaLink, bars: TimelineBar[]): MediaLink | null {
  if (bars.length === 0) return null;
  const [bar, ...copies] = bars;
  const { copies: _old, ...rest } = link;
  void _old;
  return { ...rest, bar, ...(copies.length && { copies }) };
}

/** Whether two stage ranges overlap, by the stages' order. */
const overlaps = (order: string[], a: { from: string; to: string }, b: { from: string; to: string }) => {
  const at = (c: string, fallback: number) => {
    const i = order.indexOf(c);
    return i >= 0 ? i : fallback;
  };
  return at(a.from, 0) <= at(b.to, order.length - 1) && at(b.from, 0) <= at(a.to, order.length - 1);
};

/** Takes everything else off an area over those stages (any of its five tracks): the newest picture wins. */
function clearArea(all: MediaLink[], keep: Placing, area: number, order: string[]): MediaLink[] {
  return all.flatMap((l) => {
    if (l.sheetId !== keep.sheetId || l.sceneNumber !== keep.sceneNumber || sameLink(l, keep)) return [l];
    const bars = barsOf(l);
    const left = bars.filter((b) => !(areaOfTrack(b.track) === area && overlaps(order, b, keep)));
    if (left.length === bars.length) return [l];
    const next = withBars(l, left);
    return next ? [next] : [];
  });
}

/**
 * A library item dropped on an area at a stage: a bar there that fills the area, playing on marker
 * arrival — so it's up whenever the marker is on its stage, in the drawing and in TouchDesigner (its ▼
 * on the timeline connects it to one of the scene's actions instead). Returns what's now being placed.
 */
export function dropOnArea(
  item: DraggedAsset,
  area: number,
  stage: string,
  scene: { sheetId: string; number: string; name: string },
  order: string[],
): Placing {
  const p: Placing = {
    sheetId: scene.sheetId,
    sceneNumber: scene.number,
    assetId: item.id,
    action: MARKER_ACTION,
    from: stage,
    to: stage,
    area,
  };
  const bar: TimelineBar = { track: area, from: stage, to: stage, place: fillArea(area) };
  updateMediaLinks((all) => {
    const cleared = clearArea(all, p, area, order);
    const mine = cleared.find((l) => sameLink(l, p));
    if (mine) {
      // Already placed on marker arrival: the new copy goes on this area as well. Only a bar already on
      // this same area is replaced — copies on other areas stay where they are.
      const kept = barsOf(mine).filter(
        (b) => !(b.from === stage && b.to === stage && b.place && areaOfTrack(b.track) === area),
      );
      return cleared.map((l) => (l === mine ? (withBars(l, [...kept, bar]) ?? l) : l));
    }
    const link: MediaLink = {
      assetId: item.id,
      sheetId: scene.sheetId,
      sceneNumber: scene.number,
      sceneName: scene.name,
      action: MARKER_ACTION,
      assetName: item.name,
      assetKind: item.kind,
      bar,
    };
    return [...cleared, { ...link, barsKind: timingOf(link).kind }];
  }, `Place ${item.id} on area ${area}`);
  setPlacing(p);
  return p;
}

/** Moves, resizes, stretches or turns the picture: every area this copy is on follows (other copies stay). */
export function setPlacement(p: Placing, place: Placement, label?: string) {
  updateMediaLinks(
    (all) =>
      all.map((l) => {
        if (!sameLink(l, p)) return l;
        const group = groupOf(l, p);
        const bars = barsOf(l).map((b) => (group.includes(b) ? { ...b, place } : b));
        return withBars(l, bars) ?? l;
      }),
    label,
  );
}

/** Clicking an area while placing: the picture goes on it (replacing what was there), or comes off it. */
export function toggleArea(p: Placing, area: number, order: string[]) {
  let after: Placing | null | undefined;
  updateMediaLinks((all) => {
    const link = all.find((l) => sameLink(l, p));
    if (!link) return all;
    const bars = barsOf(link);
    const group = groupOf(link, p);
    const on = group.find((b) => areaOfTrack(b.track) === area);
    if (on) {
      const rest = group.filter((b) => b !== on);
      // The copy comes off its last area: placing stops. Off the area it was picked up by: another of its areas.
      if (!rest.length) after = null;
      else if (p.area === area) after = { ...p, area: areaOfTrack(rest[0].track) ?? undefined };
      const left = bars.filter((b) => b !== on);
      const next = withBars(link, left);
      return next ? all.map((l) => (l === link ? next : l)) : all.filter((l) => l !== link);
    }
    const place = group[0]?.place;
    if (!place) return all;
    const cleared = clearArea(all, p, area, order);
    return cleared.map((l) => {
      if (!sameLink(l, p)) return l;
      // Another copy of this file already on that area (same stages) gives way to this one.
      const kept = barsOf(l).filter(
        (b) => !(b.place && b.from === p.from && b.to === p.to && areaOfTrack(b.track) === area),
      );
      return withBars(l, [...kept, { track: area, from: p.from, to: p.to, place }]) ?? l;
    });
  }, `Area ${area}`);
  if (after !== undefined) setPlacing(after);
}

/** Deletes the picture being placed: this copy's bars on every area for those stages (one undo step). */
export function removePlacement(p: Placing) {
  updateMediaLinks((all) => {
    const link = all.find((l) => sameLink(l, p));
    if (!link) return all;
    const group = groupOf(link, p);
    const left = barsOf(link).filter((b) => !group.includes(b));
    const next = withBars(link, left);
    return next ? all.map((l) => (l === link ? next : l)) : all.filter((l) => l !== link);
  }, `Delete ${p.assetId}`);
  setPlacing(null);
}

/** The placed picture showing on an area at a stage (to pick it up by clicking it), if any. */
export function placingAt(links: MediaLink[], scene: { sheetId: string; number: string }, area: number, stage: string, order: string[]): Placing | null {
  for (const l of links) {
    if (l.sheetId !== scene.sheetId || l.sceneNumber !== scene.number) continue;
    const bar = barsOf(l).find((b) => b.place && areaOfTrack(b.track) === area && overlaps(order, b, { from: stage, to: stage }));
    if (bar)
      return { sheetId: l.sheetId, sceneNumber: l.sceneNumber, assetId: l.assetId, action: l.action, from: bar.from, to: bar.to, area };
  }
  return null;
}

// --- for TouchDesigner: each area's slice of a placed picture ---------------------------------------

/**
 * An area's four corners in the drawing (top-left, top-right, bottom-right, bottom-left) — the frame its
 * projector output fills: a four-sided outline's own corners (in perspective); for an outline with a
 * corner cut away (2, 5, 10), the rectangle around it (the projector covers the whole surface, masked).
 */
function cornersOf(area: number): [number, number][] {
  const s = SHAPES.get(area)!;
  const b = boxOfShape(s);
  if (s.points.length !== 4)
    return [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ];
  const near = (x: number, y: number) =>
    s.points.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? p : best));
  return [near(b.x, b.y), near(b.x + b.width, b.y), near(b.x + b.width, b.y + b.height), near(b.x, b.y + b.height)];
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];
const multiply = (a: Mat3, b: Mat3): Mat3 => {
  const m = (r: number, c: number) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return [m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2)];
};
function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(
    (n) => n / det,
  ) as Mat3;
}

/**
 * The unit square onto a four-sided shape, in perspective (Heckbert's square-to-quad): (0,0) → q[0],
 * (1,0) → q[1], (1,1) → q[2], (0,1) → q[3]. Divide by the third value.
 */
export function squareToQuad(q: [number, number][]): Mat3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

// --- corner pin: a placed picture's corners moved on their own (Command-drag a corner handle) ---------

/** A picture's corners in its own frame (0-1 across and down; top-left, top-right, bottom-right, bottom-left). */
export const UNPINNED: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
export const pinOf = (p: Placement): [number, number][] => p.pin ?? UNPINNED;

/** Whether four corners still make a shape a picture can be drawn on (convex, not folded over). */
export function pinIsConvex(q: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const [cx, cy] = q[(i + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** A corner of the picture in its own frame (u, v) → the picture's unturned frame around its centre. */
export const pinLocal = (p: Placement, [u, v]: [number, number]): [number, number] => [(u - 0.5) * p.w, (v - 0.5) * p.h];

/** The picture's four corners on the drawing (top-left, top-right, bottom-right, bottom-left), pinned or not. */
export function placeCorners(p: Placement): [number, number][] {
  const r = (p.rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pinOf(p).map((c) => {
    const [x, y] = pinLocal(p, c);
    return [p.cx + x * cos - y * sin, p.cy + x * sin + y * cos];
  });
}

/**
 * A CSS matrix3d taking a w x h box (its top-left at 0,0) onto the pinned corners in that box's own frame —
 * how the drawing shows a corner-pinned picture in perspective.
 */
export function pinCssMatrix(w: number, h: number, pin: [number, number][]): string {
  const H = multiply(
    squareToQuad(pin.map(([u, v]) => [u * w, v * h])),
    [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1],
  );
  const k = H[8];
  const [a, b, c, d, e, f, g, hh, i] = H.map((n) => n / k);
  return `matrix3d(${[a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, i].join(',')})`;
}

/**
 * Where each point of an area's projector output falls on a placed picture: a 3x3 matrix (row by row)
 * taking the output's u, v (0-1, v upwards, as TouchDesigner has them) to the picture's u, v (the same
 * way up) — divide by the third value. The output fills the area's outline as drawn (in perspective),
 * so a picture spread over several areas lines up as it does on the drawing.
 */
export function areaUvMatrix(area: number, place: Placement): number[] {
  const [tl, tr, br, bl] = cornersOf(area);
  // The unit square to the outline: (0,0) bottom-left … (0,1) top-left.
  const square = squareToQuad([bl, br, tr, tl]);
  if (place.pin) {
    // Corner-pinned: the drawing to the picture is a perspective one — from its four corners on the
    // drawing (bottom-left = 0,0 … top-left = 0,1, v upwards) back to the unit square.
    const [ptl, ptr, pbr, pbl] = placeCorners(place);
    const m = multiply(invert(squareToQuad([pbl, pbr, ptr, ptl])), square);
    // Scaled so the third value is 1 at the area's middle (TouchDesigner only draws where it's positive).
    const z = m[6] * 0.5 + m[7] * 0.5 + m[8];
    return m.map((n) => Math.round((n / z) * 1e6) / 1e6);
  }
  // The drawing to the picture: back to its centre, unturned, scaled to 0-1 (v upwards).
  const r = (-place.rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const toPicture: Mat3 = [
    cos / place.w,
    -sin / place.w,
    0.5 - (cos * place.cx - sin * place.cy) / place.w,
    -sin / place.h,
    -cos / place.h,
    0.5 + (sin * place.cx + cos * place.cy) / place.h,
    0,
    0,
    1,
  ];
  return multiply(toPicture, square).map((n) => Math.round(n * 1e6) / 1e6);
}
