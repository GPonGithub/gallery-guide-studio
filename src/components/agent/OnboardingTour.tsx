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
};

const PROGRESS_KEY = 'chatbot-designer-onboarding';
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

export function OnboardingTour({ steps, children }: { steps: TourStep[]; children: (start: () => void) => ReactNode }) {
  const [step, setStep] = useState<number | null>(null);
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

  const end = useCallback(
    (finished: boolean) => {
      void closePanels([]);
      setStep((current) => {
        if (current !== null) writeProgress({ step: finished ? 0 : current, finished });
        return null;
      });
      setLayout(null);
    },
    [closePanels],
  );

  // Entering a step: open its panels (one at a time — an inner one only exists once the outer is open), then bring the control into view.
  useEffect(() => {
    if (step === null) return;
    writeProgress({ step, finished: false });
    const current = steps[step];
    let cancelled = false;
    void (async () => {
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
  }, [step, steps, closePanels]);

  // Follow the control as things move: panels opening, scrolling, the window resizing.
  useLayoutEffect(() => {
    if (step === null) return;
    let frame = 0;
    let last = '';
    const tick = () => {
      const marker = steps[step].target;
      const own = marker ? find(marker) : null;
      const fallback = steps[step].fallback;
      const el = own ?? (fallback ? find(fallback.target) : null);
      const rect = el ? el.getBoundingClientRect() : null;
      const next = layoutFor(rect, cardRef.current?.offsetHeight ?? 260);
      const key = JSON.stringify([next.placement, Math.round(next.left), Math.round(next.top), Math.round(next.arrowAt), rect && [rect.left, rect.top, rect.width, rect.height].map(Math.round)]);
      if (key !== last) {
        last = key;
        setLayout(next);
        setTargetFound(!marker || Boolean(own && own.getBoundingClientRect().width > 0));
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
            </div>
            <div className="flex items-center justify-between gap-2 border-t-2 border-ink pt-3">
              <button onClick={() => setStep((s) => (s ? s - 1 : s))} disabled={step === 0} className={`${buttonOutline} disabled:invisible`}>
                Go back
              </button>
              {isLast ? (
                <button onClick={() => end(true)} className={buttonPrimary}>
                  Finish onboarding
                </button>
              ) : (
                <button onClick={() => setStep((s) => (s === null ? s : s + 1))} className={buttonPrimary}>
                  Next
                </button>
              )}
            </div>
          </div>
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
