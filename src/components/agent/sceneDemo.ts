import type { TourHelpers } from './OnboardingTour';

/**
 * The onboarding tour's Scenes demonstration: the pointer names and saves a
 * scene, starts another, reorders them and archives one — in the real Scenes
 * window, step by step as the student clicks Next.
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

/** Types a name into the Scenes window and saves — what a student does for a new scene. */
async function nameAndSave(h: TourHelpers, name: string, beforeSave?: () => Promise<void>) {
  const field = (await h.find('[data-tour="scene-name"]')) as HTMLInputElement;
  h.show(field.parentElement);
  await h.type(field, name);
  if (beforeSave) await beforeSave();
  const save = await h.find('[data-tour="scene-save"]');
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
  // New scenes start at the top; the ↓ key on ⋮⋮ moves this one under the first, before saving.
  await nameAndSave(h, SECOND, async () => {
    const draft = await h.find('[data-scene-draft]');
    const handle = handleOf(draft);
    if (!handle) return;
    h.show(draft);
    await h.press(handle, 'ArrowDown');
  });
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
      if (!archivedRow(FIRST)) {
        const first = row(FIRST);
        const archive = first?.querySelector<HTMLElement>('[data-scene-archive]');
        if (!first || !archive) return;
        h.show(first);
        await h.click(archive);
      }
      const archived = await h.find('[data-tour="scenes-archived"]');
      h.show(archived);
      archived.scrollIntoView({ block: 'nearest' });
    },
  };
}
