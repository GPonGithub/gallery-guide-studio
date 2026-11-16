import type { TourHelpers, TourStep } from './OnboardingTour';
import { DEMO_ACTIONS, DEMO_STAGES, beginMediaDemo } from '@/lib/agent/mediaDemo';

// The Adding Immersive Media "Onboard Me" tour. It runs on a demo scene with three demo files
// (see mediaDemo.ts): the demo scene has its own media folder and library, so the student's are never
// touched. Every step is in the 'media-demo' group, so leaving
// the tour (Next at the end, Close, or reloading) tidies the demo away.

const [PICTURE_ACTION, , DING_ACTION] = DEMO_ACTIONS;
const VIDEO = 'DEMO-1';
const PICTURE = 'DEMO-2';
const DING = 'DEMO-3';
const MUSIC = 'DEMO-4';
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

/** Opens a zone's rows on the timeline (or folds them away), as its heading's arrow does. */
async function zoneOpen(h: TourHelpers, zone: number, open: boolean) {
  const heading = await h.find(`[data-tour="timeline-zone-${zone}"]`);
  if ((heading.getAttribute('aria-expanded') === 'true') !== open) await h.click(heading);
}

/** Where on the screen a stage's column crosses a row (the middle of that cell). */
function cell(stage: number, rowY: number) {
  const tracks = el('[data-tour="timeline-tracks"]')!.getBoundingClientRect();
  return { x: tracks.left + (tracks.width / DEMO_STAGES.length) * (stage + 0.5), y: rowY };
}
const middleY = (e: HTMLElement) => {
  const r = e.getBoundingClientRect();
  return r.top + r.height / 2;
};
/** A bar dragged in from the library and not yet connected to an action, on a ♪ sound track. */
const looseSoundBar = () => el('[data-bar=""][data-bar-track^="sound"]');
const markerBar = () => el(q('data-bar', '@marker-arrival'));

/** The picture dragged from the Media Library onto area 2's row, stage 2A. */
async function pictureDropped(h: TourHelpers) {
  await ready(h);
  await zoneOpen(h, 2, true);
  if (markerBar()) return;
  const item = await h.find(q('data-asset', PICTURE));
  h.showBoth(item, el('[data-tour="timeline"]'));
  const row = await h.find('[data-tour="timeline-area-2"]');
  await h.dragTo(item, cell(1, middleY(row)));
  await h.find(q('data-bar', '@marker-arrival'));
}

/** The music dragged from the Media Library onto zone 2's ♪ sound track, stage 2B. */
async function musicDropped(h: TourHelpers) {
  await ready(h);
  await zoneOpen(h, 2, true);
  if (looseSoundBar()) return;
  const item = await h.find(q('data-asset', MUSIC));
  h.showBoth(item, el('[data-tour="timeline"]'));
  const row = await h.find('[data-tour="timeline-sound"]');
  await h.dragTo(item, cell(2, middleY(row)));
  await h.find('[data-bar=""][data-bar-track^="sound"]');
}

/** Clicks the music's bar (a press and let go, not a drag): Spatialized Audio opens on it. */
async function spatialOpen(h: TourHelpers) {
  await musicDropped(h);
  const b = looseSoundBar()!;
  // Press it near its left end, clear of its volume slider and buttons.
  await h.move(b, 0, 0);
  return h.find('[data-tour="spatial-square"] [role="slider"]');
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

  // Drag a picture from the library straight onto the timeline.
  'drag-timeline': async (h) => {
    await pictureDropped(h);
    h.showBoth(el(q('data-asset', PICTURE)), markerBar());
  },

  // Or drop it on the room drawing: it lands on that area, on the marker's stage.
  'drag-drawing': async (h) => {
    await ready(h);
    const two = el('[data-tour="zone-buttons"] button:nth-of-type(2)');
    if (two && two.getAttribute('aria-pressed') !== 'true') await h.click(two);
    const item = await h.find(q('data-asset', VIDEO));
    const room = await h.find('[data-tour="room-diagram"]');
    h.showBoth(item, room);
    const label = await h.find('[data-area-label="5"]');
    const r = label.getBoundingClientRect();
    await h.dragTo(item, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    await h.wait(1500);
  },

  // Sounds go on the ♪ sound track.
  'drag-sound': async (h) => {
    await musicDropped(h);
    h.showBoth(el(q('data-asset', MUSIC)), looseSoundBar());
  },

  // Zones fold open and closed on the timeline.
  'zones-fold': async (h) => {
    await ready(h);
    h.show(el('[data-tour="timeline"]'));
    await zoneOpen(h, 1, true);
    await h.wait(1200);
    await zoneOpen(h, 1, false);
    await zoneOpen(h, 2, true);
    const buttons = el('[data-tour="zone-buttons"]');
    if (buttons) await h.point(buttons);
  },

  // Each area opens into up to five tracks.
  'area-tracks': async (h) => {
    await ready(h);
    await zoneOpen(h, 2, true);
    h.show(el('[data-tour="timeline"]'));
    const area = await h.find('[data-tour="timeline-area-2"]');
    if (area.getAttribute('aria-expanded') !== 'true') await h.click(area);
    await h.wait(2500);
    const again = await h.find('[data-tour="timeline-area-2"]');
    if (again.getAttribute('aria-expanded') === 'true') await h.click(again);
  },

  // Click a sound's bar: Spatialized Audio opens; drag the blue dot to place it in the room.
  'spatial-place': async (h) => {
    const square = await spatialOpen(h);
    h.showBoth(square, looseSoundBar());
    await h.move(square, 150, -70);
    await h.wait(600);
    await h.move(square, -120, 110);
  },

  // Record Movement: move the dot while the music plays; it moves the same way every time it plays.
  'spatial-record': async (h) => {
    const square = await spatialOpen(h);
    h.show(el('[data-tour="spatial-square"]'));
    const record = await h.find('[data-tour="spatial-record"]');
    if (!record.textContent?.includes('Stop')) await h.click(record);
    // At natural speed, so the moves fit inside the eight seconds of music.
    h.setPace(0.5);
    await h.move(square, 170, -60);
    await h.move(square, -60, 160);
    await h.move(square, -150, -140);
    h.setPace(1);
    // The recording stops by itself when the music ends.
    for (let i = 0; i < 40 && el('[data-tour="spatial-record"]')?.textContent?.includes('Stop'); i++) await h.wait(250);
    await h.wait(800);
    const play = el('[data-tour="spatial-play"]');
    if (play) {
      await h.click(play);
      await h.wait(4000);
      const stop = el('[data-tour="spatial-play"]');
      if (stop?.textContent?.includes('Stop')) await h.click(stop);
    }
  },

  // TouchDesigner: point at the buttons (nothing is sent to the room).
  'td-tools': async (h) => {
    h.show(await h.find('[data-tour="media-4"]'));
    for (const marker of ['td-connect', 'td-projections', 'td-numbers', 'td-scene-label']) {
      const b = el(`[data-tour="${marker}"]`);
      if (b) {
        await h.point(b);
        await h.wait(900);
      }
    }
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
          The tour uses a <b>demo scene</b> with its own demo files. Your own scenes&rsquo; media folders and
          connections aren&rsquo;t touched.
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
          Each scene has its <b>own media folder</b>: keep that scene&rsquo;s images, video and sound in one folder,
          and connect it here (<b>Choose media folder</b>) while the scene is open. Each file gets an ID that never changes. Switch scenes and the
          library, timeline and room show that scene&rsquo;s folder.
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

  // --- Dragging media in -----------------------------------------------------
  {
    title: 'Drag media onto the timeline',
    group: GROUP,
    open: LIBRARY,
    run: 'drag-timeline',
    body: (
      <p>
        Drag a picture, video or AI character from the Media Library straight onto a section&rsquo;s row of the
        timeline, at the stage where it should appear. A blue bar appears; it shows in the room when the conversation
        reaches that stage. Its <b>▼</b> can connect it to one of the scene&rsquo;s actions instead.
      </p>
    ),
  },
  {
    title: 'Or drop it on the drawing',
    group: GROUP,
    open: LIBRARY,
    run: 'drag-drawing',
    body: (
      <p>
        You can also drop it straight onto a section of the <b>room drawing</b>: it goes up in that section at once,
        and its bar is added to the timeline at the marker&rsquo;s stage.
      </p>
    ),
  },
  {
    title: 'Sound goes on the ♪ track',
    group: GROUP,
    open: LIBRARY,
    run: 'drag-sound',
    body: (
      <p>
        Drag a sound onto the green <b>♪</b> sound track at the bottom of a zone. Its bar is green; its <b>▼</b>{' '}
        connects it to an action (when it plays), and its slider sets its volume, up to 400%.
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
        Across: the conversation&rsquo;s <b>stages</b>. Down: the room&rsquo;s <b>zones</b>, each with its sections
        (numbered as in the drawing), then its ♪ sound track. A bar shows when something happens and where.{' '}
        <b>◀ ▶</b> step through the stages.
      </p>
    ),
  },
  {
    title: 'Open and close zones',
    group: GROUP,
    open: LIBRARY,
    run: 'zones-fold',
    body: (
      <p>
        Each zone&rsquo;s dark heading (<b>Z1</b>, <b>Z2</b>, <b>Z3</b>) folds its rows open and closed, so you only
        see the zones you&rsquo;re working on. The <b>Zone</b> buttons at the top choose which zone&rsquo;s drawing
        shows.
      </p>
    ),
  },
  {
    title: 'Up to 5 spaces in each section',
    group: GROUP,
    open: LIBRARY,
    run: 'area-tracks',
    body: (
      <p>
        Click a section&rsquo;s number to open it into <b>five tracks</b> (2.1–2.5): up to five different pieces of
        media for that section, stage by stage. Click it again to fold them back into one row.
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
        Drag a blue bar&rsquo;s end to <b>stretch it across more stages</b>, drag its middle to move it to another section, and hold{' '}
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

  // --- Sound in the room --------------------------------------------------------
  {
    title: 'Place a sound in the room',
    group: GROUP,
    open: [...LIBRARY, 'media-6'],
    run: 'spatial-place',
    body: (
      <>
        <p>
          Click a sound&rsquo;s bar — or a video&rsquo;s bar if the video has sound — and <b>6 · Spatialized audio</b>{' '}
          opens on it: the room from above, a speaker in each corner.
        </p>
        <p>
          Drag the <b>blue dot</b> to balance the sound between the four speakers: towards a corner and that speaker
          plays it; in the middle, all four play it evenly. Where you leave it is remembered.
        </p>
      </>
    ),
  },
  {
    title: 'Record a movement',
    group: GROUP,
    open: [...LIBRARY, 'media-6'],
    run: 'spatial-record',
    body: (
      <p>
        Click <b>● Record Movement</b>: the sound plays, and wherever you move the dot as it plays is recorded. The
        sound then moves round the room the same way <b>every time it plays</b>. Record again to replace it, or delete
        the recording to keep it in one place.
      </p>
    ),
  },

  // --- TouchDesigner and microphones --------------------------------------------
  {
    title: 'TouchDesigner: projectors and labels',
    group: GROUP,
    open: ['process-media', 'media-4'],
    run: 'td-tools',
    body: (
      <ul>
        <li>
          <b>Connect / Disconnect</b> links the app to TouchDesigner, which drives the projectors.
        </li>
        <li>
          <b>Show projections</b> opens the picture on every projector.
        </li>
        <li>
          <b>Show / Hide numbers</b> labels each projected section with its number, for lining things up.
        </li>
        <li>
          <b>Show / Hide scene label</b>: the small label on zone 1 · area 2 — microphone on or off, the scene&rsquo;s
          number and title.
        </li>
      </ul>
    ),
  },
  {
    title: 'Two people, two microphones',
    group: GROUP,
    open: ['process-media', 'media-8'],
    body: (
      <>
        <p>
          A scene can have <b>two people</b> talking to the chatbot, each on their own microphone (left and right of
          the DJI receiver).
        </p>
        <p>
          In the Google Sheet, in the scene&rsquo;s <b>Describe this conversation</b> section, make it clear that
          there are two people: <b>name them</b> and give the rules — who they are, and how the chatbot should answer
          each of them.
        </p>
        <p>
          The app picks up those names automatically: the first person named is on the <b>left</b> microphone, the
          second on the <b>right</b> — section 8 shows who is on which side. It&rsquo;s up to you to give each actor
          the right microphone.
        </p>
      </>
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
        The demo is cleared away when you finish, and the open scene&rsquo;s media is back in use. Open{' '}
        <b>Onboard Me</b> again any time.
      </p>
    ),
  },
];
