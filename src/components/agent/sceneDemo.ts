import type { TourHelpers } from './OnboardingTour';

/**
 * The onboarding tour's Scenes demonstration: the pointer names and saves a
 * scene, starts another, reorders them, archives one and points out Complete
 * restart — in the real Scenes window, step by step as the student clicks Next.
 *
 * It runs in a sandbox (see `begin` in the page): the student's open work is
 * put aside first and comes back untouched afterwards, and only the demo's own
 * scenes are deleted when the demo is left. Each stage checks what's already
 * done, so going back and forward never makes duplicates.
 */

export const DEMO_SCENE_NAMES = ['Test Scene Number 1', 'Test Scene Number 2'] as const;
const [FIRST, SECOND] = DEMO_SCENE_NAMES;

export type SceneDemoPage = {
  /** Puts the student's open work aside and opens a blank scene (once per demo). */
  begin: () => Promise<void>;
};

const row = (name: string) => document.querySelector<HTMLElement>(`[data-scene-row="${name}"]`);
const archivedRow = (name: string) => document.querySelector<HTMLElement>(`[data-scene-archived="${name}"]`);
const handleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('button');

async function openScenes(h: TourHelpers) {
  if (!document.querySelector('[data-tour="scenes-dialog"]')) {
    const button = await h.find('[data-tour="scenes-button"]');
    h.show(button);
    await h.click(button);
  }
  return h.find('[data-tour="scenes-dialog"]');
}

/** Types a name into the new scene's strip and saves — what a student does for a new scene. */
async function nameAndSave(h: TourHelpers, name: string, beforeSave?: () => Promise<void>) {
  const field = (await h.find('[data-scene-draft] [data-tour="scene-name"]')) as HTMLInputElement;
  h.show(field.closest('[data-scene-draft]') ?? field.parentElement);
  await h.type(field, name);
  if (beforeSave) await beforeSave();
  const save = await h.find('[data-scene-draft] [data-tour="scene-save"]');
  h.show(save);
  await h.click(save);
  const saved = await h.find(`[data-scene-row="${name}"]`);
  h.show(saved);
}

async function ensureFirst(h: TourHelpers, page: SceneDemoPage) {
  await page.begin();
  await openScenes(h);
  if (row(FIRST) || archivedRow(FIRST)) return;
  await nameAndSave(h, FIRST);
}

async function ensureSecond(h: TourHelpers, page: SceneDemoPage) {
  await ensureFirst(h, page);
  if (row(SECOND) || archivedRow(SECOND)) return;
  const fresh = await h.find('[data-tour="scene-new"]');
  h.show(fresh);
  await h.click(fresh);
  await nameAndSave(h, SECOND);
  // New scenes start at the top: drag this one down, under the first (the next stage drags it back up).
  const second = row(SECOND);
  const first = row(FIRST);
  const handle = second && handleOf(second);
  if (!second || !first || !handle) return;
  if (second.getBoundingClientRect().top < first.getBoundingClientRect().top) {
    h.show(second);
    await h.drag(handle, first, 'below');
  }
}

export function sceneDemoActions(page: SceneDemoPage): Record<string, (h: TourHelpers) => Promise<void>> {
  return {
    'scenes-name': async (h) => {
      await ensureFirst(h, page);
      const done = row(FIRST);
      if (done) h.show(done);
    },
    'scenes-new': async (h) => {
      await ensureSecond(h, page);
      const done = row(SECOND);
      if (done) h.show(done);
    },
    'scenes-reorder': async (h) => {
      await ensureSecond(h, page);
      const first = row(FIRST);
      const second = row(SECOND);
      if (!first || !second) return;
      if (second.getBoundingClientRect().top < first.getBoundingClientRect().top) {
        h.show(second);
        return;
      }
      const handle = handleOf(second);
      if (!handle) return;
      h.show(second);
      await h.drag(handle, first);
      const moved = await h.find(`[data-scene-row="${SECOND}"]`);
      h.show(moved);
    },
    'scenes-archive': async (h) => {
      await ensureSecond(h, page);
      // Half the usual demo speed: archiving is quick, and easy to miss.
      h.setPace(2);
      if (!archivedRow(FIRST)) {
        const first = row(FIRST);
        const archive = first?.querySelector<HTMLElement>('[data-scene-archive]');
        if (!first || !archive) return;
        h.show(first);
        await h.click(archive);
      }
      const archived = await h.find('[data-tour="scenes-archived"]');
      archived.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await h.wait(600);
      h.show(archived);
      await h.wait(600);
    },
    // Only pointed at — never clicked.
    'scenes-restart': async (h) => {
      await ensureSecond(h, page);
      const restart = await h.find('[data-tour="complete-restart"]');
      restart.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await h.wait(400);
      h.show(restart);
    },
  };
}
