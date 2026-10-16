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
  /** Plays what follows this many times slower again (e.g. 2 = half the usual demo speed). */
  setPace: (times: number) => void;
  /** Outlines this element (instead of the step's target) and puts the card beside it. */
  show: (el: HTMLElement | null) => void;
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

function readProgress(): Progress | null {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}
function writeProgress(progress: Progress) {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
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
};

function layoutFor(rect: DOMRect | null, cardHeight: number): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - EDGE * 2);
  const center = { rect, placement: 'center' as const, left: (vw - width) / 2, top: Math.max(EDGE, (vh - cardHeight) / 2), arrowAt: 0 };
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
    return { rect, placement, left, top, arrowAt: clamp(midY - top, 18, cardHeight - 18) };
  }
  const left = clamp(midX - width / 2, EDGE, vw - width - EDGE);
  const top = placement === 'below' ? rect.bottom + GAP : Math.max(EDGE, rect.top - GAP - cardHeight);
  return { rect, placement, left, top, arrowAt: clamp(midX - left, 18, width - 18) };
}

export function OnboardingTour({
  steps,
  actions,
  onLeaveGroup,
  children,
}: {
  steps: TourStep[];
  /** Demonstrations steps can play (see TourStep.run). */
  actions?: Record<string, (h: TourHelpers) => Promise<void>>;
  /** Called when the tour leaves a group of steps (by Next, Go back, closing or finishing) — to tidy up after a demo. */
  onLeaveGroup?: (group: string) => Promise<void> | void;
  children: (start: () => void) => ReactNode;
}) {
  const [step, setStep] = useState<number | null>(null);
  /** A demonstration is playing: Next and Go back wait for it. */
  const [running, setRunning] = useState(false);
  const [demoProblem, setDemoProblem] = useState<string | null>(null);
  /** The demo's pointer: where it is, whether it's pressed, and whether to glide or jump there. */
  const [pointer, setPointer] = useState<{ x: number; y: number; pressed: boolean; glide: boolean; key?: string; pace?: number } | null>(null);
  /** What a demo is outlining right now (instead of the step's target). */
  const shown = useRef<HTMLElement | null>(null);
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
    const saved = readProgress();
    if (saved && !saved.finished && saved.step > 0 && saved.step < total) setOfferResume(saved.step);
    else setStep(0);
  };

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
        if (current !== null) writeProgress({ step: finished ? 0 : current, finished });
        return null;
      });
      setLayout(null);
    },
    [closePanels, leaveGroup],
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
    const pull = async (handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) => {
      let at = from;
      const fire = (type: string) =>
        handle.dispatchEvent(
          new PointerEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
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
    };
  }, []);

  // Entering a step: open its panels (one at a time — an inner one only exists once the outer is open), then bring the control into view.
  useEffect(() => {
    if (step === null) return;
    writeProgress({ step, finished: false });
    const current = steps[step];
    let cancelled = false;
    shown.current = null;
    void (async () => {
      // Leaving a group (e.g. the scenes demo) tidies it up before anything else happens.
      if ((current.group ?? null) !== group.current) {
        await leaveGroup();
        group.current = current.group ?? null;
      }
      if (!current.run) setPointer(null);
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
      // Panels slide open; scroll once they've settled.
      setTimeout(() => !cancelled && target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }), 250);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, steps, closePanels, leaveGroup, helpers]);


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
      const next = layoutFor(rect, cardRef.current?.offsetHeight ?? 260);
      const key = JSON.stringify([next.placement, Math.round(next.left), Math.round(next.top), Math.round(next.arrowAt), rect && [rect.left, rect.top, rect.width, rect.height].map(Math.round)]);
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
      {children(start)}

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
          {layout.rect ? (
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

          <div
            ref={cardRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-title"
            tabIndex={-1}
            className="pointer-events-auto absolute flex flex-col gap-3 border-2 border-ink bg-paper p-5 shadow-[6px_6px_0_0_rgba(0,0,0,0.2)] outline-none transition-[left,top] duration-200"
            style={{ left: layout.left, top: layout.top, width }}
          >
            {layout.rect && layout.placement !== 'center' && <Arrow placement={layout.placement} at={layout.arrowAt} />}
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
