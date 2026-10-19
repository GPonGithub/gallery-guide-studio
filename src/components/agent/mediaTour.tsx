import type { TourHelpers, TourStep } from './OnboardingTour';
import { DEMO_ACTIONS, DEMO_STAGES, beginMediaDemo } from '@/lib/agent/mediaDemo';

// The Adding Immersive Media "Onboard Me" tour. It runs on a demo scene with three demo files
// (see mediaDemo.ts): the student's own media folder, library and connections are put aside first
// and come back untouched when the tour ends. Every step is in the 'media-demo' group, so leaving
// the tour (Next at the end, Close, or reloading) tidies the demo away.

const [PICTURE_ACTION, , DING_ACTION] = DEMO_ACTIONS;
const VIDEO = 'DEMO-1';
const PICTURE = 'DEMO-2';
const DING = 'DEMO-3';
const GROUP = 'media-demo';
const LIBRARY = ['process-media', 'media-2'];

const q = (attr: string, value: string) => `[${attr}="${CSS.escape(value)}"]`;
const el = (selector: string) => document.querySelector<HTMLElement>(selector);
const bar = (action: string, index = 0) => el(`${q('data-bar', action)}${q('data-bar-index', String(index))}`);
const connection = (asset: string, action: string) => el(`${q('data-asset', asset)} ${q('data-connection', action)}`);
const isOpenConnection = (row: HTMLElement) => row.querySelector('button[aria-expanded="true"]') !== null;

/** The demo is on and its files are in the Media Library. */
async function ready(h: TourHelpers) {
  await beginMediaDemo();
  await h.find(q('data-asset', VIDEO));
}

/** Connects a demo file to one of the demo actions, as a student does (unless it's connected already). */
async function connect(h: TourHelpers, asset: string, action: string) {
  await ready(h);
  if (connection(asset, action)) return;
  const toggle = await h.find(`${q('data-asset', asset)} [data-connect-toggle]`);
  h.show(toggle.closest('li'));
  if (toggle.getAttribute('aria-expanded') !== 'true') await h.click(toggle);
  const option = await h.find(`${q('data-asset', asset)} ${q('data-action-option', action)}`);
  h.show(option.closest('ul'));
  await h.wait(500);
  await h.click(option);
  await h.find(q('data-bar', action));
}

/** Opens (or folds) a connection's settings. */
async function setOpen(h: TourHelpers, asset: string, action: string, open: boolean) {
  const row = connection(asset, action);
  if (!row || isOpenConnection(row) === open) return;
  const toggle = row.querySelector<HTMLElement>('button[aria-expanded]');
  if (toggle) await h.click(toggle);
}

/** Sizes on the timeline, read from the screen: a stage's width, and where a projection area's row is. */
function grid() {
  const tracks = el('[data-tour="timeline-tracks"]')!.getBoundingClientRect();
  const rowY = (area: number) => {
    const r = el(`[data-tour="timeline-area-${area}"]`)!.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  return { stage: tracks.width / DEMO_STAGES.length, rowY, row: rowY(2) - rowY(1) };
}
const barY = (b: HTMLElement) => {
  const r = b.getBoundingClientRect();
  return r.top + r.height / 2;
};

/** The picture's bar as the arranging steps leave it: two stages long, on area 3, with a copy on area 6. */
async function stretched(h: TourHelpers) {
  await connect(h, PICTURE, PICTURE_ACTION);
  const b = bar(PICTURE_ACTION)!;
  const g = grid();
  if (b.getBoundingClientRect().width < g.stage * 1.5) {
    const end = b.querySelector<HTMLElement>('[data-bar-end="to"]')!;
    await h.move(end, g.stage * 1.6, 0);
  }
}
async function moved(h: TourHelpers) {
  await stretched(h);
  const b = bar(PICTURE_ACTION)!;
  const g = grid();
  if (Math.abs(barY(b) - g.rowY(3)) > g.row / 2) {
    await h.move(b, 0, g.rowY(3) - barY(b));
  }
}
async function duplicated(h: TourHelpers) {
  await moved(h);
  if (bar(PICTURE_ACTION, 1)) return;
  const b = bar(PICTURE_ACTION)!;
  const g = grid();
  await h.move(b, 0, g.rowY(6) - barY(b), true);
  await h.find(`${q('data-bar', PICTURE_ACTION)}${q('data-bar-index', '1')}`);
}

export const mediaTourActions: Record<string, (h: TourHelpers) => Promise<void>> = {
  'media-begin': async () => {
    await beginMediaDemo();
  },

  // Step 3: the library's files.
  'media-library': async (h) => {
    await ready(h);
    h.show(await h.find('[data-tour="media-list"]'));
  },

  // Step 4: Connect with Action → pick the action → the connection, and its bar on the timeline.
  'connect-pick': async (h) => {
    await ready(h);
    h.show(el(q('data-asset', PICTURE)));
    await connect(h, PICTURE, PICTURE_ACTION);
    h.showBoth(el(q('data-asset', PICTURE)), bar(PICTURE_ACTION));
  },

  // Step 5: "When it plays", then Try it — the picture appears in the room.
  'plays-try': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    h.show(connection(PICTURE, PICTURE_ACTION));
    await setOpen(h, PICTURE, PICTURE_ACTION, true);
    const row = connection(PICTURE, PICTURE_ACTION)!;
    const when = row.querySelector<HTMLElement>('[data-when-plays]');
    if (when) await h.point(when);
    const tryIt = [...row.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes('Try it'));
    if (tryIt) {
      await h.click(tryIt);
      h.showBoth(row, el('[data-tour="room-diagram"]'));
      await h.wait(2500);
      await h.click(tryIt);
    }
    await setOpen(h, PICTURE, PICTURE_ACTION, false);
    h.show(connection(PICTURE, PICTURE_ACTION));
  },

  // Step 6: a sound, connected the same way — its bar on the ♪ track.
  'sound-connect': async (h) => {
    await ready(h);
    h.show(el(q('data-asset', DING)));
    await connect(h, DING, DING_ACTION);
    h.showBoth(el(q('data-asset', DING)), bar(DING_ACTION));
  },

  // Step 7: the timeline — stages across, the room's sections down.
  'timeline-intro': async (h) => {
    await ready(h);
    h.showBoth(await h.find('[data-tour="timeline"]'), el('[data-tour="room-diagram"]'));
  },

  // Step 8: stretch, move to another section, Option-drag a copy.
  'bar-arrange': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    // The whole timeline stays highlighted (it doesn't shift as bars are dragged), so the card stays put.
    h.show(el('[data-tour="timeline"]'));
    await duplicated(h);
  },

  // Step 9: delete the copy, then the last bar — the file is disconnected from the action.
  'bar-delete': async (h) => {
    await duplicated(h);
    h.show(el('[data-tour="timeline"]'));
    for (const index of [1, 0]) {
      const x = bar(PICTURE_ACTION, index)?.querySelector<HTMLElement>('[data-bar-delete]');
      if (x) await h.click(x);
    }
  },
};

export const MEDIA_TOUR_STEPS: TourStep[] = [
  {
    title: 'Adding Immersive Media',
    group: GROUP,
    run: 'media-begin',
    open: ['process-media'],
    body: (
      <>
        <p>
          Bring your pictures, video and sound into a scene: get your files in, connect them to what the scene does,
          then place them in the room.
        </p>
        <p>
          The tour uses a <b>demo scene</b> and demo files. Your own media folder and connections are put aside and come
          back exactly as they were when it ends.
        </p>
      </>
    ),
  },

  // --- Your files ------------------------------------------------------------
  {
    title: 'Choose your media folder',
    group: GROUP,
    run: 'media-begin',
    target: 'media-folder-button',
    open: ['process-media', 'media-1'],
    body: (
      <>
        <p>
          Keep all your project&rsquo;s images, video and sound in one folder, and choose it here. Each file gets an ID
          that never changes.
        </p>
        <p className="text-xs text-muted-ink">
          To copy a folder&rsquo;s full path on a Mac: select it in Finder and press <b>Option + Command + C</b>. If
          video thumbnails don&rsquo;t show, click <b>Run npm install</b> below.
        </p>
      </>
    ),
  },
  {
    title: 'The Media Library',
    group: GROUP,
    open: LIBRARY,
    run: 'media-library',
    body: (
      <p>
        Every file in your folder, with a thumbnail. Click one to preview it; the buttons above the list arrange it, and
        the search box finds a file by name or ID.
      </p>
    ),
  },

  // --- Connecting ------------------------------------------------------------
  {
    title: 'Connect a file to an action',
    group: GROUP,
    open: LIBRARY,
    run: 'connect-pick',
    body: (
      <p>
        <b>Connect with Action</b> lists what the scene does with media (row 8 of the sheet). Pick one: the file is
        connected to it, and a blue bar appears on the timeline.
      </p>
    ),
  },
  {
    title: 'When it plays, and Try it',
    group: GROUP,
    open: LIBRARY,
    run: 'plays-try',
    body: (
      <p>
        Open a connection to set <b>when it plays</b> — once, every time, throughout the scene… <b>▶ Try it</b> shows it
        in the room now, without a conversation.
      </p>
    ),
  },
  {
    title: 'Sounds work the same way',
    group: GROUP,
    open: LIBRARY,
    run: 'sound-connect',
    body: <p>Connect a sound to an action just like a picture. Its bar goes on the ♪ sound track.</p>,
  },

  // --- The timeline ----------------------------------------------------------
  {
    title: 'The timeline',
    group: GROUP,
    open: LIBRARY,
    run: 'timeline-intro',
    body: (
      <p>
        Across: the conversation&rsquo;s <b>stages</b>. Down: the room&rsquo;s <b>sections 1–11</b>, as numbered in the
        drawing, then sound. A bar shows when an action happens and where. <b>◀ ▶</b> step through the stages.
      </p>
    ),
  },
  {
    title: 'Arrange a bar',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-arrange',
    body: (
      <p>
        Drag a bar&rsquo;s end to cover more stages, drag its middle to move it to another section, and hold{' '}
        <b>Option</b> while dragging to copy it into a second section.
      </p>
    ),
  },
  {
    title: 'Delete a bar',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-delete',
    body: (
      <p>
        A bar&rsquo;s <b>×</b> deletes it. Deleting an action&rsquo;s last bar disconnects the file from that action —
        the scene itself isn&rsquo;t touched.
      </p>
    ),
  },

  // --- Keeping it current ----------------------------------------------------
  {
    title: 'Refresh This Scene',
    group: GROUP,
    run: 'media-begin',
    target: 'refresh-scene',
    open: ['process-media'],
    body: (
      <p>
        Added a new action to row 8 of the sheet? <b>Refresh This Scene</b> reads the sheet again, and the new action
        appears in Connect with Action.
      </p>
    ),
  },
  {
    title: 'That’s it',
    group: GROUP,
    body: (
      <p>
        The demo is cleared away when you finish, and your own media folder and connections come back. Open{' '}
        <b>Onboard Me</b> again any time.
      </p>
    ),
  },
];
