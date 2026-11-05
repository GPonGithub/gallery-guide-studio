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
 * those stages.
 */

/** The placed picture being edited: a connection, and the stages its placed bars cover. */
export type Placing = { sheetId: string; sceneNumber: string; assetId: string; action: string; from: string; to: string };

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

/** The placed bars a Placing refers to (its connection's bars with a placement over those stages). */
export function placedBars(links: MediaLink[], p: Placing): { link: MediaLink; bars: TimelineBar[] } | null {
  const link = links.find(
    (l) => l.sheetId === p.sheetId && l.sceneNumber === p.sceneNumber && l.assetId === p.assetId && l.action === p.action,
  );
  if (!link) return null;
  const bars = barsOf(link).filter((b) => b.place && b.from === p.from && b.to === p.to);
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
  };
  const bar: TimelineBar = { track: area, from: stage, to: stage, place: fillArea(area) };
  updateMediaLinks((all) => {
    const cleared = clearArea(all, p, area, order);
    const mine = cleared.find((l) => sameLink(l, p));
    if (mine) {
      // Already placed on marker arrival: this placement replaces its bars over these stages.
      const kept = barsOf(mine).filter((b) => !(b.from === stage && b.to === stage && b.place));
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

/** Moves, resizes, stretches or turns the picture: every area it's on follows. */
export function setPlacement(p: Placing, place: Placement, label?: string) {
  updateMediaLinks(
    (all) =>
      all.map((l) => {
        if (!sameLink(l, p)) return l;
        const bars = barsOf(l).map((b) => (b.place && b.from === p.from && b.to === p.to ? { ...b, place } : b));
        return withBars(l, bars) ?? l;
      }),
    label,
  );
}

/** Clicking an area while placing: the picture goes on it (replacing what was there), or comes off it. */
export function toggleArea(p: Placing, area: number, order: string[]) {
  let gone = false;
  updateMediaLinks((all) => {
    const link = all.find((l) => sameLink(l, p));
    if (!link) return all;
    const bars = barsOf(link);
    const group = bars.filter((b) => b.place && b.from === p.from && b.to === p.to);
    const on = group.find((b) => areaOfTrack(b.track) === area);
    if (on) {
      const left = bars.filter((b) => b !== on);
      gone = !left.some((b) => b.place && b.from === p.from && b.to === p.to);
      const next = withBars(link, left);
      return next ? all.map((l) => (l === link ? next : l)) : all.filter((l) => l !== link);
    }
    const place = group[0]?.place;
    if (!place) return all;
    const cleared = clearArea(all, p, area, order);
    return cleared.map((l) =>
      sameLink(l, p) ? (withBars(l, [...barsOf(l), { track: area, from: p.from, to: p.to, place }]) ?? l) : l,
    );
  }, `Area ${area}`);
  if (gone) setPlacing(null);
}

/** Deletes the picture being placed: its bars on every area for those stages (one undo step). */
export function removePlacement(p: Placing) {
  updateMediaLinks((all) => {
    const link = all.find((l) => sameLink(l, p));
    if (!link) return all;
    const left = barsOf(link).filter((b) => !(b.place && b.from === p.from && b.to === p.to));
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
    if (bar) return { sheetId: l.sheetId, sceneNumber: l.sceneNumber, assetId: l.assetId, action: l.action, from: bar.from, to: bar.to };
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

type Mat3 = [number, number, number, number, number, number, number, number, number];
const multiply = (a: Mat3, b: Mat3): Mat3 => {
  const m = (r: number, c: number) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return [m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2)];
};

/**
 * Where each point of an area's projector output falls on a placed picture: a 3x3 matrix (row by row)
 * taking the output's u, v (0-1, v upwards, as TouchDesigner has them) to the picture's u, v (the same
 * way up) — divide by the third value. The output fills the area's outline as drawn (in perspective),
 * so a picture spread over several areas lines up as it does on the drawing.
 */
export function areaUvMatrix(area: number, place: Placement): number[] {
  const [tl, tr, br, bl] = cornersOf(area);
  // The unit square to the outline (Heckbert's square-to-quad): (0,0) bottom-left … (0,1) top-left.
  const [x0, y0] = bl;
  const [x1, y1] = br;
  const [x2, y2] = tr;
  const [x3, y3] = tl;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const square: Mat3 = [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
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
