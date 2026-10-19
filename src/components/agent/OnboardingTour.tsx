'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { buttonOutline, buttonPrimary, fieldLabel } from '@/lib/styles';

/**
 * "Onboard Me": a guided tour of the real interface. Each step opens the
 * panels it talks about, dims everything else, and points at the control
 * with an arrow from a small card placed beside it.
 *
 * Steps find their controls by `data-tour="…"` markers on the elements
 * themselves (not screen positions), so the tour keeps working as the
 * layout changes. It only ever opens and closes panels — it never presses
 * a button that changes anything — and closes again whatever it opened.
 * The page stays usable underneath: the dimming doesn't catch clicks.
 *
 * Progress is remembered in this browser, so a tour left part-way can be
 * picked up again.
 */

export type TourStep = {
  title: string;
  body: ReactNode;
  /** The `data-tour` marker of the control to point at; none = a card in the middle. */
  target?: string;
  /** Markers of panels to open first, outermost first (a toggle button, a <details>, or a panel section). */
  open?: string[];
  /** Said when the control isn't on screen (e.g. nothing generated yet). */
  missing?: string;
  /**
   * What to point at meanwhile — e.g. the button that makes the control
   * appear — and the panels that needs open. The tour switches to the
   * control itself as soon as it appears.
   */
  fallback?: { target: string; open?: string[] };
  /** A demonstration to play on this step (a key of the tour's `actions`). Next waits until it's done. */
  run?: string;
  /** Steps that belong together (e.g. a demo); leaving the group calls `onLeaveGroup`. */
  group?: string;
};

/**
 * What a demonstration can do: a visible pointer moves to each control, then
 * clicks, types or drags — on the real interface, so it's exactly what the
 * student would do. Each call stops if the student leaves the step.
 */
export type TourHelpers = {
  /** Waits (up to ~3s) for an element to appear. */
  find: (selector: string) => Promise<HTMLElement>;
  point: (el: HTMLElement) => Promise<void>;
  click: (el: HTMLElement) => Promise<void>;
  type: (el: HTMLInputElement, text: string) => Promise<void>;
  /** Presses a key (e.g. 'ArrowDown') on an element, shown as a little key label by the pointer. */
  press: (el: HTMLElement, key: string) => Promise<void>;
  /** Drags `handle` (a pointer-driven drag handle) up or down until it's just above — or below — `target`. */
  drag: (handle: HTMLElement, target: HTMLElement, place?: 'above' | 'below') => Promise<void>;
  /** Drags `handle` sideways by `dx` pixels (e.g. a column's resize border). */
  slide: (handle: HTMLElement, dx: number) => Promise<void>;
  /** Drags `handle` by `dx`, `dy` pixels — with Option (Alt) held if `alt` (e.g. to duplicate a timeline bar). */
  move: (handle: HTMLElement, dx: number, dy: number, alt?: boolean) => Promise<void>;
  /** Picks an option of a dropdown (<select>) by its value. */
  choose: (select: HTMLSelectElement, value: string) => Promise<void>;
  /** Plays what follows this many times slower again (e.g. 2 = half the usual demo speed). */
  setPace: (times: number) => void;
  /** Outlines this element (instead of the step's target) and puts the card beside it. */
  show: (el: HTMLElement | null) => void;
  /**
   * Outlines two elements at once: the card sits beside the first (its arrow on it) and keeps clear of the
   * second, which gets an arrow of its own — so the card stays put while both are pointed at.
   */
  showBoth: (first: HTMLElement | null, second: HTMLElement | null) => void;
  wait: (ms: number) => Promise<void>;
};

class Stopped extends Error {}

const PROGRESS_KEY = 'chatbot-designer-onboarding';
/** How much slower than "natural" the demonstrations play (2 = half speed), so they're easy to follow. */
const DEMO_PACE = 2;
const CARD_WIDTH = 360;
const GAP = 18; // between the card and what it points at
const EDGE = 12; // nearest the card goes to the window's edge

type Progress = { step: number; finished: boolean };

function readProgress(key: string): Progress | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}
function writeProgress(key: string, progress: Progress) {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // Storage blocked — the tour just won't remember where it was.
  }
}

const find = (marker: string) => document.querySelector<HTMLElement>(`[data-tour="${marker}"]`);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The element that opens or closes a marked panel. */
function toggleOf(marker: string): HTMLElement | null {
  const el = find(marker);
  if (!el) return null;
  if (el.tagName === 'DETAILS' || el.hasAttribute('aria-expanded')) return el;
  return el.querySelector<HTMLElement>(':scope > button[aria-expanded]');
}
function isOpen(toggle: HTMLElement) {
  return toggle.tagName === 'DETAILS' ? (toggle as HTMLDetailsElement).open : toggle.getAttribute('aria-expanded') === 'true';
}
function setOpen(toggle: HTMLElement, open: boolean) {
  if (isOpen(toggle) === open) return;
  if (toggle.tagName === 'DETAILS') (toggle as HTMLDetailsElement).open = open;
  else toggle.click();
}

type Placement = 'right' | 'left' | 'below' | 'above' | 'center';
type Layout = {
  rect: DOMRect | null;
  placement: Placement;
  left: number;
  top: number;
  /** Where the arrow sits along the card's edge (px from its top or left). */
  arrowAt: number;
  /** A second element pointed at (see TourHelpers.showBoth). */
  also: DOMRect | null;
  /** The card's height as measured (for the second arrow). */
  cardHeight?: number;
  /** The notch can't face the control squarely from where the card is: an arrow line points at it instead. */
  connector?: boolean;
};

/** How far a card staying put within a step may be from what it points at (an arrow line bridges the gap). */
const MAX_REACH = 900;

type Box = { left: number; top: number; right: number; bottom: number };
const cardBox = (at: { left: number; top: number }, width: number, height: number): Box => ({
  left: at.left,
  top: at.top,
  right: at.left + width,
  bottom: at.top + height,
});
const overlap = (a: Box, b: Box, margin: number) =>
  a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
const gapBetween = (a: Box, b: Box) =>
  Math.hypot(Math.max(0, b.left - a.right, a.left - b.right), Math.max(0, b.top - a.bottom, a.top - b.bottom));

/**
 * Whether the card can stay where it is while pointing at `rect` (and `also`): it still fits on screen,
 * covers neither, and isn't too far away.
 */
function canStay(at: { left: number; top: number }, height: number, rect: DOMRect, also: DOMRect | null) {
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const card = cardBox(at, width, height);
  if (card.top < 0 || card.bottom > window.innerHeight || card.left < 0 || card.right > window.innerWidth) return false;
  if (overlap(card, rect, GAP / 2) || (also && overlap(card, also, GAP / 2))) return false;
  return gapBetween(card, rect) <= MAX_REACH && (!also || gapBetween(card, also) <= MAX_REACH);
}

/**
 * The smallest move that lets the card stay near where it is — straight up, down, left or right just
 * clear of what it points at — or null if none works (then it's placed afresh).
 */
function nudge(at: { left: number; top: number }, height: number, rect: DOMRect, also: DOMRect | null) {
  if (canStay(at, height, rect, also)) return at;
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const inside = { top: Math.max(EDGE, Math.min(at.top, vh - height - EDGE)), left: Math.max(EDGE, Math.min(at.left, vw - width - EDGE)) };
  const candidates = [inside];
  for (const r of also ? [rect, also] : [rect]) {
    candidates.push(
      { ...inside, top: r.top - GAP - height },
      { ...inside, top: r.bottom + GAP },
      { ...inside, left: r.left - GAP - width },
      { ...inside, left: r.right + GAP },
    );
  }
  const moved = (c: { left: number; top: number }) => Math.hypot(c.left - at.left, c.top - at.top);
  return candidates.filter((c) => canStay(c, height, rect, also)).sort((a, b) => moved(a) - moved(b))[0] ?? null;
}

/**
 * The card stays where it is; its notch slides round its edge to face `rect` — or, when no edge
 * faces it squarely, an arrow line points at it (connector).
 */
function aimFrom(at: { left: number; top: number }, height: number, rect: DOMRect, also: DOMRect | null): Layout {
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const card = cardBox(at, width, height);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const reach = 18; // the notch keeps this far from the card's corners
  const levelWith = rect.bottom > card.top + reach && rect.top < card.bottom - reach;
  const aboveOrBelowWith = rect.right > card.left + reach && rect.left < card.right - reach;
  const sides: { placement: Placement; gap: number; square: boolean }[] = [
    { placement: 'right', gap: card.left - rect.right, square: levelWith },
    { placement: 'left', gap: rect.left - card.right, square: levelWith },
    { placement: 'below', gap: card.top - rect.bottom, square: aboveOrBelowWith },
    { placement: 'above', gap: rect.top - card.bottom, square: aboveOrBelowWith },
  ];
  const facing = sides.filter((s) => s.gap >= 0);
  const square = facing.find((s) => s.square);
  const side = square ?? facing.sort((a, b) => b.gap - a.gap)[0] ?? sides[0];
  const midY = rect.top + rect.height / 2;
  const midX = rect.left + rect.width / 2;
  const arrowAt =
    side.placement === 'right' || side.placement === 'left'
      ? clamp(midY - card.top, reach, height - reach)
      : clamp(midX - card.left, reach, width - reach);
  return { rect, placement: side.placement, left: at.left, top: at.top, arrowAt, also, cardHeight: height, connector: !square };
}

/** The card beside `rect`, moved up or down out of the way of `also` if it would cover it. */
function layoutForBoth(rect: DOMRect | null, also: DOMRect | null, cardHeight: number): Layout {
  const base = layoutFor(rect, cardHeight);
  if (!also || !rect || base.placement === 'center') return { ...base, also, cardHeight };
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const overlaps = (top: number) =>
    base.left < also.right + GAP && base.left + width > also.left - GAP && top < also.bottom + GAP && top + cardHeight > also.top - GAP;
  let top = base.top;
  if (overlaps(top)) {
    const above = also.top - GAP - cardHeight;
    const below = also.bottom + GAP;
    top = above >= EDGE ? above : below + cardHeight <= vh - EDGE ? below : top;
  }
  const midY = rect.top + rect.height / 2;
  const arrowAt =
    base.placement === 'right' || base.placement === 'left'
      ? Math.max(18, Math.min(midY - top, cardHeight - 18))
      : base.arrowAt;
  return { ...base, top, arrowAt, also, cardHeight };
}

function layoutFor(rect: DOMRect | null, cardHeight: number): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - EDGE * 2);
  const center = { rect, placement: 'center' as const, left: (vw - width) / 2, top: Math.max(EDGE, (vh - cardHeight) / 2), arrowAt: 0, also: null };
  if (!rect || rect.width === 0 || rect.bottom < 0 || rect.top > vh) return { ...center, rect: null };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const midY = rect.top + rect.height / 2;
  const midX = rect.left + rect.width / 2;
  const sides: [Placement, number][] = [
    ['right', vw - rect.right - GAP - EDGE],
    ['left', rect.left - GAP - EDGE],
    ['below', vh - rect.bottom - GAP - EDGE],
    ['above', rect.top - GAP - EDGE],
  ];
  // Beside it if there's room for the card's width, else above or below if there's room for its height.
  const fits = sides.find(([side, room]) => (side === 'right' || side === 'left' ? room >= width : room >= cardHeight));
  const placement = fits?.[0] ?? (sides.slice(2).sort((a, b) => b[1] - a[1])[0][0] as Placement);
  if (placement === 'right' || placement === 'left') {
    const left = placement === 'right' ? rect.right + GAP : rect.left - GAP - width;
    const top = clamp(midY - cardHeight / 2, EDGE, vh - cardHeight - EDGE);
    return { rect, placement, left, top, arrowAt: clamp(midY - top, 18, cardHeight - 18), also: null };
  }
  const left = clamp(midX - width / 2, EDGE, vw - width - EDGE);
  const top = placement === 'below' ? rect.bottom + GAP : Math.max(EDGE, rect.top - GAP - cardHeight);
  return { rect, placement, left, top, arrowAt: clamp(midX - left, 18, width - 18), also: null };
}

export function OnboardingTour({
  steps,
  actions,
  onLeaveGroup,
  startRef,
  progressKey = PROGRESS_KEY,
  children,
}: {
  steps: TourStep[];
  /** Where this tour remembers how far it got (each tour its own). */
  progressKey?: string;
  /** Demonstrations steps can play (see TourStep.run). */
  actions?: Record<string, (h: TourHelpers) => Promise<void>>;
  /** Called when the tour leaves a group of steps (by Next, Go back, closing or finishing) — to tidy up after a demo. */
  onLeaveGroup?: (group: string) => Promise<void> | void;
  /** Filled in with the tour's start, for a button elsewhere on the page (e.g. beside a section's heading). */
  startRef?: { current: (() => void) | null };
  /** Renders what starts the tour, here — or nothing, if `startRef` is used instead. */
  children?: (start: () => void) => ReactNode;
}) {
  const [step, setStep] = useState<number | null>(null);
  /** A demonstration is playing: Next and Go back wait for it. */
  const [running, setRunning] = useState(false);
  const [demoProblem, setDemoProblem] = useState<string | null>(null);
  /** The demo's pointer: where it is, whether it's pressed, and whether to glide or jump there. */
  const [pointer, setPointer] = useState<{ x: number; y: number; pressed: boolean; glide: boolean; key?: string; pace?: number } | null>(null);
  /** What a demo is outlining right now (instead of the step's target). */
  const shown = useRef<HTMLElement | null>(null);
  /** A second element a demo is pointing at (showBoth). */
  const shownAlso = useRef<HTMLElement | null>(null);
  /** Where the card was placed — kept while it can point from there (see canStay). */
  const pinned = useRef<{ left: number; top: number } | null>(null);
  /** The step the card was last placed for: each new step places it afresh, beside what that step is about. */
  const placedFor = useRef<number | null>(null);
  /** A demonstration is playing (for the layout loop, which runs outside React's renders). */
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  /** The group of steps the tour is in. */
  const group = useRef<string | null>(null);
  // The page's latest demo actions and tidy-up, without restarting a step every time the page re-renders.
  const actionsRef = useRef(actions);
  const onLeaveRef = useRef(onLeaveGroup);
  useEffect(() => {
    actionsRef.current = actions;
    onLeaveRef.current = onLeaveGroup;
  });
  const [offerResume, setOfferResume] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [targetFound, setTargetFound] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** Panels the tour opened (it closes them again; ones the user opened are left alone). */
  const openedByTour = useRef<string[]>([]);
  const total = steps.length;

  const start = () => {
    const saved = readProgress(progressKey);
    if (saved && !saved.finished && saved.step > 0 && saved.step < total) setOfferResume(saved.step);
    else setStep(0);
  };

  useEffect(() => {
    if (startRef) startRef.current = start;
  });

  const closePanels = useCallback(async (keep: string[]) => {
    // Innermost first, so a panel inside another closes before it.
    for (const marker of [...openedByTour.current].reverse()) {
      if (keep.includes(marker)) continue;
      const toggle = toggleOf(marker);
      if (toggle) setOpen(toggle, false);
      openedByTour.current = openedByTour.current.filter((m) => m !== marker);
      await nextFrame();
    }
  }, []);

  const leaveGroup = useCallback(async () => {
    const left = group.current;
    group.current = null;
    if (left) await onLeaveRef.current?.(left);
  }, []);

  const end = useCallback(
    (finished: boolean) => {
      void leaveGroup();
      setPointer(null);
      setRunning(false);
      void closePanels([]);
      setStep((current) => {
        if (current !== null) writeProgress(progressKey, { step: finished ? 0 : current, finished });
        return null;
      });
      setLayout(null);
      pinned.current = null;
      placedFor.current = null;
    },
    [closePanels, leaveGroup, progressKey],
  );

  // The demonstration's hands. `stopped` says the student has moved on.
  const helpers = useCallback((stopped: () => boolean): TourHelpers => {
    const check = () => {
      if (stopped()) throw new Stopped();
    };
    const wait = async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      check();
    };
    // The demonstration's own timings, at the demo pace (and any extra slowing a stage asks for).
    let extra = 1;
    const slow = (ms: number) => wait(ms * DEMO_PACE * extra);
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
    };
    const point = async (el: HTMLElement) => {
      check();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await slow(60);
      setPointer({ ...centre(el), pressed: false, glide: true, pace: extra });
      await slow(700);
    };
    // Press on `handle`, move (eased, so it starts and ends gently) to `to`, let go. It always lets
    // go — even if the student moves on mid-drag — so nothing is left held.
    const pull = async (handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, altKey = false) => {
      let at = from;
      const fire = (type: string) =>
        handle.dispatchEvent(
          new PointerEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, altKey }),
        );
      setPointer({ ...from, pressed: true, glide: false });
      fire('pointerdown');
      try {
        await slow(200);
        const moves = 28;
        for (let i = 1; i <= moves; i++) {
          const t = i / moves;
          const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          at = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
          setPointer({ ...at, pressed: true, glide: false });
          fire('pointermove');
          await slow(35);
        }
        await slow(250);
      } finally {
        fire('pointerup');
      }
      setPointer({ ...to, pressed: false, glide: false });
      await slow(600);
    };
    return {
      wait,
      point,
      show: (el) => {
        shown.current = el;
        shownAlso.current = null;
      },
      showBoth: (first, second) => {
        shown.current = first;
        shownAlso.current = second;
      },
      find: async (selector) => {
        for (let tries = 0; tries < 60; tries++) {
          const el = document.querySelector<HTMLElement>(selector);
          if (el) return el;
          await wait(50);
        }
        throw new Error('Part of the screen this demonstration uses didn’t appear.');
      },
      click: async (el) => {
        await point(el);
        setPointer((p) => p && { ...p, pressed: true });
        await slow(160);
        el.click();
        setPointer((p) => p && { ...p, pressed: false });
        await slow(450);
      },
      press: async (el, key) => {
        await point(el);
        el.focus();
        setPointer((p) => p && { ...p, pressed: true, key: key.replace('Arrow', '') });
        await slow(200);
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await slow(500);
        setPointer((p) => p && { ...p, pressed: false, key: undefined });
        await slow(300);
      },
      type: async (el, text) => {
        await point(el);
        el.focus();
        // React only sees a typed value through the input's own setter and an input event.
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        const put = (value: string) => {
          setValue.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        put('');
        for (let i = 1; i <= text.length; i++) {
          await slow(70);
          put(text.slice(0, i));
        }
        await slow(400);
      },
      setPace: (times) => {
        extra = times;
      },
      drag: async (handle, target, place = 'above') => {
        await point(handle);
        const from = centre(handle);
        const box = target.getBoundingClientRect();
        await pull(handle, from, { x: from.x, y: place === 'above' ? box.top + 6 : box.bottom - 6 });
      },
      slide: async (handle, dx) => {
        await point(handle);
        const from = centre(handle);
        await pull(handle, from, { x: from.x + dx, y: from.y });
      },
      move: async (handle, dx, dy, alt = false) => {
        await point(handle);
        const from = centre(handle);
        if (alt) setPointer((p) => p && { ...p, key: '⌥ Option' });
        await pull(handle, from, { x: from.x + dx, y: from.y + dy }, alt);
      },
      choose: async (select, value) => {
        await point(select);
        setPointer((p) => p && { ...p, pressed: true });
        await slow(200);
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
        setValue.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        setPointer((p) => p && { ...p, pressed: false });
        await slow(600);
      },
    };
  }, []);

  // Entering a step: open its panels (one at a time — an inner one only exists once the outer is open), then bring the control into view.
  useEffect(() => {
    if (step === null) return;
    writeProgress(progressKey, { step, finished: false });
    const current = steps[step];
    let cancelled = false;
    shown.current = null;
    shownAlso.current = null;
    void (async () => {
      // Leaving a group (e.g. the scenes demo) tidies it up before anything else happens.
      if ((current.group ?? null) !== group.current) {
        await leaveGroup();
        group.current = current.group ?? null;
      }
      setPointer(null);
      const wanted = current.open ?? [];
      await closePanels(wanted);
      for (const marker of wanted) {
        let toggle: HTMLElement | null = null;
        for (let tries = 0; tries < 20 && !toggle && !cancelled; tries++) {
          toggle = toggleOf(marker);
          if (!toggle) await nextFrame();
        }
        if (cancelled || !toggle) continue;
        if (!isOpen(toggle)) {
          setOpen(toggle, true);
          if (!openedByTour.current.includes(marker)) openedByTour.current.push(marker);
        }
        await nextFrame();
      }
      const action = current.run ? actionsRef.current?.[current.run] : undefined;
      if (action && !cancelled) {
        setRunning(true);
        try {
          await action(helpers(() => cancelled));
        } catch (err) {
          if (!(err instanceof Stopped) && !cancelled) {
            setDemoProblem(err instanceof Error ? err.message : 'The demonstration couldn’t finish.');
          }
        } finally {
          if (!cancelled) setRunning(false);
        }
        return;
      }
      if (cancelled || !current.target) return;
      let target: HTMLElement | null = null;
      for (let tries = 0; tries < 20 && !target && !cancelled; tries++) {
        target = find(current.target);
        if (!target) await nextFrame();
      }
      // Not there yet: open what the stand-in needs, and point at that instead.
      if (!target && current.fallback && !cancelled) {
        for (const marker of current.fallback.open ?? []) {
          const toggle = toggleOf(marker);
          if (toggle && !isOpen(toggle)) {
            setOpen(toggle, true);
            if (!openedByTour.current.includes(marker)) openedByTour.current.push(marker);
          }
          await nextFrame();
        }
        target = find(current.fallback.target);
      }
      // Panels slide open; scroll once they've settled — and again if opening several pushed it out of view.
      const reveal = (onlyIfHidden: boolean) => {
        if (cancelled || !target) return;
        const r = target.getBoundingClientRect();
        if (onlyIfHidden && r.top >= 0 && r.bottom <= window.innerHeight) return;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      };
      setTimeout(() => reveal(false), 250);
      setTimeout(() => reveal(true), 800);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, steps, closePanels, leaveGroup, helpers, progressKey]);


  // Follow the control as things move: panels opening, scrolling, the window resizing.
  useLayoutEffect(() => {
    if (step === null) return;
    let frame = 0;
    let last = '';
    const tick = () => {
      const marker = steps[step].target;
      const own = marker ? find(marker) : null;
      const fallback = steps[step].fallback;
      const demo = shown.current?.isConnected ? shown.current : null;
      const el = demo ?? own ?? (fallback ? find(fallback.target) : null);
      const rect = el ? el.getBoundingClientRect() : null;
      const second = demo && shownAlso.current?.isConnected ? shownAlso.current.getBoundingClientRect() : null;
      const height = cardRef.current?.offsetHeight ?? 260;
      // Each step places the card beside what it's about. Within the step it then stays put while the
      // demonstration moves between parts of the screen (the Media Library and the timeline, say): only
      // the notch moves round its edge to the new highlight. It moves only to get out of the way or back
      // on screen — the smallest move that does it.
      const visible = rect && rect.width > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
      const at = pinned.current;
      const sameStep = placedFor.current === step;
      const near = visible && at && sameStep ? nudge(at, height, rect, second) : null;
      const waiting = !visible && (steps[step].target || shown.current || runningRef.current);
      let next: Layout;
      if (near) {
        pinned.current = near;
        next = aimFrom(near, height, rect!, second);
      } else if (at && waiting) {
        // Nothing to point at just now — a demo about to show something, or its control off screen for a
        // moment (scrolling, a list re-drawing): the card waits where it is rather than jumping to the middle.
        next = { rect: null, placement: 'center', left: at.left, top: at.top, arrowAt: 0, also: null };
      } else {
        next = layoutForBoth(rect, second, height);
        pinned.current = next.placement === 'center' ? null : { left: next.left, top: next.top };
        placedFor.current = step;
      }
      const box = (r: DOMRect | null) => r && [r.left, r.top, r.width, r.height].map(Math.round);
      const key = JSON.stringify([next.placement, Math.round(next.left), Math.round(next.top), Math.round(next.arrowAt), box(rect), box(second), next.cardHeight, next.connector]);
      if (key !== last) {
        last = key;
        setLayout(next);
        setTargetFound(Boolean(demo) || !marker || Boolean(own && own.getBoundingClientRect().width > 0));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, steps]);

  // Escape ends the tour.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, end]);

  // A new step's card takes the focus, so it's read out and the keyboard starts there.
  useEffect(() => {
    if (step !== null) cardRef.current?.focus({ preventScroll: true });
  }, [step]);

  const current = step !== null ? steps[step] : null;
  const isLast = step === total - 1;
  const width = typeof window === 'undefined' ? CARD_WIDTH : Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const pad = 6;

  return (
    <>
      {children?.(start)}

      {offerResume !== null && (
        <div data-tour-ui className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="tour-resume-title" className="relative flex w-full max-w-sm flex-col gap-4 border-2 border-ink bg-paper p-5">
            <button onClick={() => setOfferResume(null)} aria-label="Close" className="absolute right-3 top-2 text-2xl leading-none text-ink hover:text-muted-ink">
              ×
            </button>
            <h2 id="tour-resume-title" className="pr-6 font-display text-xl text-ink">
              Continue the tour?
            </h2>
            <p className="font-body text-sm text-ink">
              You stopped at step {offerResume + 1} of {total}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                autoFocus
                onClick={() => {
                  setStep(offerResume);
                  setOfferResume(null);
                }}
                className={buttonPrimary}
              >
                Pick up where I left off
              </button>
              <button
                onClick={() => {
                  setStep(0);
                  setOfferResume(null);
                }}
                className={buttonOutline}
              >
                Start again
              </button>
            </div>
          </div>
        </div>
      )}

      {current && layout && (
        <div data-tour-ui className="pointer-events-none fixed inset-0 z-[70]">
          {/* Dims everything but the control (clicks still go through to the page). */}
          {layout.rect && layout.also ? (
            <TwoHoles first={layout.rect} second={layout.also} pad={pad} />
          ) : layout.rect ? (
            <div
              className="absolute border-[3px] border-[#18a0fb] transition-all duration-200"
              style={{
                left: layout.rect.left - pad,
                top: layout.rect.top - pad,
                width: layout.rect.width + pad * 2,
                height: layout.rect.height + pad * 2,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.38)',
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-ink/30" />
          )}

          {layout.rect && layout.connector && layout.cardHeight && (
            <SecondArrow
              card={{ left: layout.left, top: layout.top, width, height: layout.cardHeight }}
              target={layout.rect}
              pad={pad}
            />
          )}
          {layout.also && layout.cardHeight && (
            <SecondArrow
              card={{ left: layout.left, top: layout.top, width, height: layout.cardHeight }}
              target={layout.also}
              pad={pad}
            />
          )}

          <div
            ref={cardRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-title"
            tabIndex={-1}
            className="pointer-events-auto absolute flex flex-col gap-3 border-2 border-ink bg-paper p-5 shadow-[6px_6px_0_0_rgba(0,0,0,0.2)] outline-none transition-[left,top] duration-200"
            style={{ left: layout.left, top: layout.top, width }}
          >
            {layout.rect && layout.placement !== 'center' && !layout.connector && (
              <Arrow placement={layout.placement} at={layout.arrowAt} />
            )}
            <button onClick={() => end(false)} aria-label="Close the tour" className="absolute right-3 top-2 text-2xl leading-none text-ink hover:text-muted-ink">
              ×
            </button>
            <p className={fieldLabel}>
              Step {step! + 1} of {total}
            </p>
            <h2 id="tour-title" className="-mt-1 pr-6 font-display text-xl leading-tight text-ink">
              {current.title}
            </h2>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto font-body text-sm leading-snug text-ink [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:list-disc [&_ul]:space-y-1">
              {current.target && !targetFound && current.missing && (
                <p className="border-l-4 border-[#b45309] pl-2 text-xs">{current.missing}</p>
              )}
              {current.body}
              {demoProblem && <p className="border-l-4 border-[#b91c1c] pl-2 text-xs">{demoProblem} You can carry on with Next.</p>}
              {running && <p className="font-label text-[10px] uppercase tracking-widest text-muted-ink">Watch… (Next is ready when it’s done)</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t-2 border-ink pt-3">
              <button
                onClick={() => {
                  setDemoProblem(null);
                  setStep((s) => (s ? s - 1 : s));
                }}
                disabled={step === 0 || running}
                className={`${buttonOutline} ${step === 0 ? 'disabled:invisible' : ''}`}
              >
                Go back
              </button>
              {isLast ? (
                <button onClick={() => end(true)} className={buttonPrimary}>
                  Finish onboarding
                </button>
              ) : (
                <button
                  onClick={() => {
                    setDemoProblem(null);
                    setStep((s) => (s === null ? s : s + 1));
                  }}
                  disabled={running} className={`${buttonPrimary} disabled:opacity-50`}>
                  Next
                </button>
              )}
            </div>
          </div>

          {/* The demonstration's pointer. */}
          {pointer && (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="28"
              height="28"
              className="absolute drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
              style={{
                left: pointer.x - 4,
                top: pointer.y - 2,
                transform: `scale(${pointer.pressed ? 0.82 : 1})`,
                transformOrigin: '4px 2px',
                transition: pointer.glide
                  ? `left ${650 * DEMO_PACE * (pointer.pace ?? 1)}ms ease-in-out, top ${650 * DEMO_PACE * (pointer.pace ?? 1)}ms ease-in-out, transform 120ms`
                  : 'transform 120ms',
              }}
            >
              <path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 14 L19 14 Z" fill="#000" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
          {pointer?.key && (
            <span
              className="absolute border-2 border-ink bg-paper px-1.5 py-0.5 font-label text-[11px] uppercase tracking-widest text-ink shadow"
              style={{ left: pointer.x + 22, top: pointer.y + 14 }}
            >
              {pointer.key === 'Down' ? '↓' : pointer.key === 'Up' ? '↑' : pointer.key}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** A solid triangle on the card's edge, pointing at the control. */
/** The dimming with two holes, and an outline round each (for showBoth). */
function TwoHoles({ first, second, pad }: { first: DOMRect; second: DOMRect; pad: number }) {
  const hole = (r: DOMRect) => ({ x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full">
      <defs>
        <mask id="tour-two-holes">
          <rect width="100%" height="100%" fill="#fff" />
          <rect {...hole(first)} fill="#000" />
          <rect {...hole(second)} fill="#000" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.38)" mask="url(#tour-two-holes)" />
      <rect {...hole(first)} fill="none" stroke="#18a0fb" strokeWidth="3" />
      <rect {...hole(second)} fill="none" stroke="#18a0fb" strokeWidth="3" />
    </svg>
  );
}

/** The arrow from the card to the second element (for showBoth): from the card's nearest edge to the element's. */
function SecondArrow({
  card,
  target,
  pad,
}: {
  card: { left: number; top: number; width: number; height: number };
  target: DOMRect;
  pad: number;
}) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  // Leave the card from the edge facing the target.
  const startX = clamp(cx, card.left, card.left + card.width);
  const startY = clamp(cy, card.top, card.top + card.height);
  // …and stop just short of the target's outline.
  const endX = clamp(startX, target.left - pad - 4, target.right + pad + 4);
  const endY = clamp(startY, target.top - pad - 4, target.bottom + pad + 4);
  if (Math.hypot(endX - startX, endY - startY) < 12) return null;
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <marker id="tour-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" fill="#000" />
        </marker>
      </defs>
      <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#000" strokeWidth="3" markerEnd="url(#tour-arrowhead)" />
    </svg>
  );
}

function Arrow({ placement, at }: { placement: Placement; at: number }) {
  const size = 14;
  const style: CSSProperties =
    placement === 'right'
      ? { left: -size - 2, top: at - size, borderWidth: `${size}px ${size}px ${size}px 0`, borderColor: 'transparent #000 transparent transparent' }
      : placement === 'left'
        ? { right: -size - 2, top: at - size, borderWidth: `${size}px 0 ${size}px ${size}px`, borderColor: 'transparent transparent transparent #000' }
        : placement === 'below'
          ? { top: -size - 2, left: at - size, borderWidth: `0 ${size}px ${size}px ${size}px`, borderColor: 'transparent transparent #000 transparent' }
          : { bottom: -size - 2, left: at - size, borderWidth: `${size}px ${size}px 0 ${size}px`, borderColor: '#000 transparent transparent transparent' };
  return <span aria-hidden="true" className="absolute h-0 w-0 border-solid" style={style} />;
}
