import type { TourHelpers } from './OnboardingTour';

/**
 * The onboarding tour's layout demonstration: the pointer drags the border
 * between Design Process and the chat wider, then back — leaving it exactly
 * where it was.
 */
/** Moves the border by `dx` in one go (no animation). */
function snap(border: HTMLElement, dx: number) {
  const box = border.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const fire = (type: string, x: number) =>
    border.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  const x = box.left + box.width / 2;
  fire('pointerdown', x);
  fire('pointermove', x + dx);
  fire('pointerup', x + dx);
}

export const LAYOUT_DEMO_ACTIONS: Record<string, (h: TourHelpers) => Promise<void>> = {
  'resize-border': async (h) => {
    const border = await h.find('[data-tour="resize-border"]');
    if (border.getBoundingClientRect().width === 0) {
      throw new Error('The border can only be dragged when the window is wide enough to show the columns side by side.');
    }
    h.show(border);
    const width = () => Number(border.getAttribute('aria-valuenow'));
    const start = width();
    // Wider if there's room, otherwise narrower.
    const room = Number(border.getAttribute('aria-valuemax')) - start;
    const dx = room >= 160 ? 160 : -120;
    // Twice the usual demo speed: it's a simple move.
    h.setPace(0.5);
    try {
      await h.slide(border, dx);
      await h.wait(450);
      await h.slide(border, -dx);
    } finally {
      // Back to exactly the width it had — straight away if the student moved on mid-demo.
      if (width() !== start) snap(border, start - width());
    }
  },
};
