import type { TourHelpers, TourStep } from './OnboardingTour';
import { DEMO_ACTIONS, DEMO_NEW_ACTION, DEMO_STAGES, addDemoAction, beginMediaDemo } from '@/lib/agent/mediaDemo';

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
    h.show(b);
    await h.move(end, g.stage * 1.6, 0);
  }
}
async function moved(h: TourHelpers) {
  await stretched(h);
  const b = bar(PICTURE_ACTION)!;
  const g = grid();
  if (Math.abs(barY(b) - g.rowY(3)) > g.row / 2) {
    h.show(b);
    await h.move(b, 0, g.rowY(3) - barY(b));
  }
}
async function duplicated(h: TourHelpers) {
  await moved(h);
  if (bar(PICTURE_ACTION, 1)) return;
  const b = bar(PICTURE_ACTION)!;
  const g = grid();
  h.show(b);
  await h.move(b, 0, g.rowY(6) - barY(b), true);
  await h.find(`${q('data-bar', PICTURE_ACTION)}${q('data-bar-index', '1')}`);
}

export const mediaTourActions: Record<string, (h: TourHelpers) => Promise<void>> = {
  'media-begin': async () => {
    await beginMediaDemo();
  },

  'media-area-tracks': async (h) => {
    await ready(h);
    const arrow = await h.find('[data-tour="timeline-area-1"]');
    const wasOpen = arrow.getAttribute('aria-expanded') === 'true';
    await h.click(arrow);
    h.show(el('[data-tour="timeline-tracks"]'));
    await h.wait(1600);
    if (!wasOpen) await h.click(arrow);
    h.show(arrow);
  },

  'media-library': async (h) => {
    await ready(h);
    h.show(await h.find('[data-tour="media-list"]'));
  },

  'connect-open': async (h) => {
    await ready(h);
    if (connection(PICTURE, PICTURE_ACTION)) {
      h.show(connection(PICTURE, PICTURE_ACTION));
      return;
    }
    const toggle = await h.find(`${q('data-asset', PICTURE)} [data-connect-toggle]`);
    h.show(toggle.closest('li'));
    if (toggle.getAttribute('aria-expanded') !== 'true') await h.click(toggle);
    h.show((await h.find(`${q('data-asset', PICTURE)} [role="listbox"]`)).closest('li'));
  },

  'connect-pick': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    // Both at once — the new connection in the library, and its bar on the timeline — so the card stays put.
    h.showBoth(el(q('data-asset', PICTURE)), bar(PICTURE_ACTION));
  },

  'settings-open': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    await setOpen(h, PICTURE, PICTURE_ACTION, true);
    h.show(connection(PICTURE, PICTURE_ACTION));
  },

  'settings-change': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    await setOpen(h, PICTURE, PICTURE_ACTION, true);
    const select = (await h.find(`${q('data-asset', PICTURE)} [data-when-plays]`)) as HTMLSelectElement;
    h.show(select);
    await h.choose(select, 'throughout');
    h.show(bar(PICTURE_ACTION));
    await h.wait(1800);
    h.show(select);
    await h.choose(select, 'once');
    h.show(bar(PICTURE_ACTION));
    await h.wait(1200);
    h.show(connection(PICTURE, PICTURE_ACTION));
  },

  'settings-try': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    await setOpen(h, PICTURE, PICTURE_ACTION, true);
    const row = connection(PICTURE, PICTURE_ACTION)!;
    const tryIt = [...row.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes('Try it'));
    if (!tryIt) return;
    await h.click(tryIt);
    h.show(el('[data-tour="room-diagram"]'));
    await h.wait(2500);
    await h.click(tryIt);
    h.show(row);
  },

  'settings-close': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    await setOpen(h, PICTURE, PICTURE_ACTION, false);
    h.show(connection(PICTURE, PICTURE_ACTION));
  },

  'bar-show': async (h) => {
    await connect(h, PICTURE, PICTURE_ACTION);
    await setOpen(h, PICTURE, PICTURE_ACTION, false);
    const b = bar(PICTURE_ACTION)!;
    await h.point(b);
    h.show(b);
  },
  'bar-stretch': async (h) => {
    await stretched(h);
    h.show(bar(PICTURE_ACTION));
  },
  'bar-move': async (h) => {
    await moved(h);
    h.show(bar(PICTURE_ACTION));
  },
  'bar-duplicate': async (h) => {
    await duplicated(h);
    h.show(el('[data-tour="timeline-tracks"]'));
  },

  'sound-connect': async (h) => {
    await connect(h, DING, DING_ACTION);
    h.show(bar(DING_ACTION));
  },
  'sound-tracks': async (h) => {
    await connect(h, DING, DING_ACTION);
    const arrow = await h.find('[data-tour="timeline-sound"]');
    if (arrow.getAttribute('aria-expanded') !== 'true') await h.click(arrow);
    const b = bar(DING_ACTION)!;
    const g = grid();
    // Down one row: onto the second sound track (if it's still on the first).
    if (b.dataset.barTrack === 'sound') {
      h.show(b);
      await h.move(b, 0, g.row);
    }
    h.show(el('[data-tour="timeline-tracks"]'));
  },
  'sound-settings': async (h) => {
    await connect(h, DING, DING_ACTION);
    await setOpen(h, DING, DING_ACTION, true);
    const row = connection(DING, DING_ACTION)!;
    h.show(row);
    await h.point(row);
  },

  'delete-copy': async (h) => {
    await duplicated(h);
    await setOpen(h, DING, DING_ACTION, false);
    const copy = bar(PICTURE_ACTION, 1);
    const x = copy?.querySelector<HTMLElement>('[data-bar-delete]');
    if (copy && x) {
      h.show(copy);
      await h.click(x);
    }
    h.show(connection(PICTURE, PICTURE_ACTION) ?? bar(PICTURE_ACTION));
  },
  'delete-last': async (h) => {
    await ready(h);
    const last = bar(PICTURE_ACTION);
    const x = last?.querySelector<HTMLElement>('[data-bar-delete]');
    if (last && x) {
      // The copy first, if it's still there (going straight to this step).
      const copy = bar(PICTURE_ACTION, 1)?.querySelector<HTMLElement>('[data-bar-delete]');
      if (copy) await h.click(copy);
      h.show(bar(PICTURE_ACTION));
      await h.click(bar(PICTURE_ACTION)!.querySelector<HTMLElement>('[data-bar-delete]')!);
    }
    h.show(el(q('data-asset', PICTURE)));
  },
  'delete-connection': async (h) => {
    await connect(h, DING, DING_ACTION);
    await setOpen(h, DING, DING_ACTION, false);
    h.show(bar(DING_ACTION));
    await h.wait(900);
    const row = connection(DING, DING_ACTION)!;
    const x = row.querySelector<HTMLElement>('button[title^="Disconnect"]');
    h.show(row);
    if (x) await h.click(x);
    h.show(el('[data-tour="timeline-tracks"]'));
  },

  'timeline-nav': async (h) => {
    await ready(h);
    const next = await h.find('[data-tour="timeline-next"]');
    const prev = await h.find('[data-tour="timeline-prev"]');
    h.show(el('[data-tour="timeline"]'));
    await h.click(next);
    await h.click(next);
    await h.click(prev);
  },

  'refresh-demo': async (h) => {
    await ready(h);
    addDemoAction();
    const toggle = await h.find(`${q('data-asset', VIDEO)} [data-connect-toggle]`);
    h.show(toggle.closest('li'));
    if (toggle.getAttribute('aria-expanded') !== 'true') await h.click(toggle);
    const option = await h.find(`${q('data-asset', VIDEO)} ${q('data-action-option', DEMO_NEW_ACTION)}`);
    await h.point(option);
    h.show(option.closest('ul'));
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
        <p>This tour shows how to bring pictures, video and sound into a scene, and how to place them in the room.</p>
        <p>
          It goes in order: the <b>Media Library</b> (your files), then <b>actions</b> (connecting files to what the
          scene does), then the <b>timeline</b> — where those actions happen — and editing it.
        </p>
        <p>
          It uses a <b>demo scene</b> with three demo files, so the pointer can connect, drag and delete for real. Your
          own media folder, library and connections are put aside and come back exactly as they were when the tour ends.
        </p>
      </>
    ),
  },

  // --- 1 · The Media Library -------------------------------------------------
  // your folder of pictures, video and sound, and how to browse it.
  {
    title: '1 · Link your media folder',
    group: GROUP,
    run: 'media-begin',
    target: 'media-folder-button',
    open: ['process-media', 'media-1'],
    body: (
      <>
        <p>
          Keep every image, video and sound file for your project in one folder (subfolders are fine). Click{' '}
          <b>Choose Media Folder</b> and pick it in the window that opens; <b>Refresh Media</b> reads it again after you
          add files.
        </p>
        <p>
          Each file gets an ID (M-001…) that never changes, and the list goes on the sheet&rsquo;s <b>Media</b> tab. The
          files stay where they are. (Chrome or Edge only.) Right now the demo folder is in use.
        </p>
      </>
    ),
  },
  {
    title: '1 · Copy the folder’s full path',
    group: GROUP,
    run: 'media-begin',
    target: 'media-folder-button',
    open: ['process-media', 'media-1'],
    body: (
      <>
        <p>
          To copy a folder&rsquo;s full path on a Mac: select it in <b>Finder</b> and press <b>Option + Command + C</b>.
          The path is now on the clipboard, ready to paste.
        </p>
        <p>
          In the app itself you choose the folder with <b>Choose Media Folder</b> — the browser can&rsquo;t open a typed
          path — so keep the copied path for anywhere else that needs to find the same files.
        </p>
      </>
    ),
  },
  {
    title: '1 · Previews and npm install',
    group: GROUP,
    run: 'media-begin',
    target: 'media-npm',
    open: ['process-media', 'media-1'],
    missing: 'This button only shows when the app runs on your own computer — the hosted site doesn’t need it.',
    body: (
      <>
        <p>
          Pictures, sounds and most video (MP4, WebM) preview straight away. Video the browser can&rsquo;t play —{' '}
          <b>ProRes .mov</b> (especially with transparency), <b>.avi</b>, <b>.mkv</b>, <b>.mpg</b>, <b>.mxf</b> — needs{' '}
          <b>ffmpeg</b> to make a first-frame still for its thumbnail and the room preview (marked &ldquo;Still&rdquo;,
          transparency kept).
        </p>
        <p>
          ffmpeg comes with the app&rsquo;s packages. Click <b>Run npm install</b> here, or in Terminal go to the
          app&rsquo;s folder (the one with <code>package.json</code>) and run <code>npm install</code>. The line beside
          it says &ldquo;✓ Video thumbnails ready&rdquo; once it&rsquo;s there.
        </p>
      </>
    ),
  },
  {
    title: '1 · The Media Library',
    group: GROUP,
    target: 'media-list',
    open: LIBRARY,
    run: 'media-library',
    body: (
      <>
        <p>
          Every file in the folder, with its thumbnail, ID, type, name and the date it was added. Here: one demo video,
          one demo picture and one demo sound.
        </p>
        <p>
          Click a video&rsquo;s thumbnail to play or pause it, and a sound&rsquo;s ♪ to hear it; <b>■</b> stops it. Drag
          the list&rsquo;s bottom edge to see more.
        </p>
      </>
    ),
  },
  {
    title: '1 · Arrange and search',
    group: GROUP,
    run: 'media-begin',
    target: 'media-arrange',
    open: LIBRARY,
    body: (
      <p>
        <b>Listed</b> (by ID), <b>Most recent</b>, <b>With actions</b> (files connected in this scene first),{' '}
        <b>Name</b>, or one type first: <b>Video</b>, <b>Sound</b>, <b>Image</b>. The search box below finds files by
        name or ID — closest matches first.
      </p>
    ),
  },

  // --- 2 · Actions -----------------------------------------------------------
  // connecting files to the scene’s media actions (row 8 of the sheet), and when they play.
  {
    title: '2 · Connect with Action',
    group: GROUP,
    open: LIBRARY,
    run: 'connect-open',
    body: (
      <>
        <p>
          <b>Connect with Action</b> lists the scene&rsquo;s media actions — row 8 of the sheet, &ldquo;Media Actions in
          this Scene&rdquo;. The demo scene has three.
        </p>
        <p>Beside each, when it will play, as read from its words.</p>
      </>
    ),
  },
  {
    title: '2 · Choose an action',
    group: GROUP,
    open: LIBRARY,
    run: 'connect-pick',
    body: (
      <p>
        Choosing &ldquo;{PICTURE_ACTION}&rdquo; connects the picture to it: a blue connection appears under the file,
        and a blue <b>bar</b> on the timeline.
      </p>
    ),
  },
  {
    title: '2 · Open its settings',
    group: GROUP,
    open: LIBRARY,
    run: 'settings-open',
    body: (
      <>
        <p>Click a connection to open its settings (click its header again to fold it to one line).</p>
        <p>
          <b>When it plays</b>: <b>Once, when user instructs</b> (when the conversation asks for it) ·{' '}
          <b>Loop, when user instructs</b> (video and sound) · <b>Every time</b> · <b>Throughout the scene</b> ·{' '}
          <b>At the start</b> · <b>At the end</b>.
        </p>
        <p>
          <b>Every time</b> adds <i>which moment</i> (before each reply, as it starts, after it, when the caller speaks)
          and, before a reply, <i>what the voice does</i> (waits for the sound, plays over it, or waits a set time).
        </p>
      </>
    ),
  },
  {
    title: '2 · Changing when it plays',
    group: GROUP,
    open: LIBRARY,
    run: 'settings-change',
    body: (
      <p>
        Set to <b>Throughout the scene</b>, the bar stretches across every stage — it shows from the call&rsquo;s start
        to its end. Back to <b>Once</b>, it sits on one stage again and waits for its moment.
      </p>
    ),
  },
  {
    title: '2 · Try it',
    group: GROUP,
    open: LIBRARY,
    run: 'settings-try',
    body: (
      <p>
        <b>▶ Try it</b> plays it now without a conversation: a picture or video appears in its section of the room (a
        sound plays). Click again to hide it.
      </p>
    ),
  },
  {
    title: '2 · Fold the settings',
    group: GROUP,
    open: LIBRARY,
    run: 'settings-close',
    body: <p>Folded, a connection is one line: the action and when it plays. The × beside it disconnects it.</p>,
  },
  {
    title: '2 · Add a sound',
    group: GROUP,
    open: LIBRARY,
    run: 'sound-connect',
    body: (
      <p>
        Sounds connect the same way: here the demo ding to &ldquo;{DING_ACTION}&rdquo;. Its bar goes on the ♪ sound
        track — &ldquo;every time&rdquo; actions span the whole scene (↻).
      </p>
    ),
  },
  {
    title: '2 · Each sound’s settings',
    group: GROUP,
    open: LIBRARY,
    run: 'sound-settings',
    body: (
      <>
        <p>
          Each sound is set in its own connection: <b>when it plays</b>, and for &ldquo;every time&rdquo;, the moment
          and what the voice does — here the voice waits for the ding before each reply.
        </p>
        <p>
          How loud every sound plays, and how much it dips while the chatbot talks, is set by <b>♫ Music / Sounds</b>{' '}
          above the chat.
        </p>
      </>
    ),
  },
  {
    title: '2 · Refresh This Scene',
    group: GROUP,
    run: 'media-begin',
    target: 'refresh-scene',
    open: ['process-media'],
    body: (
      <>
        <p>
          <b>Refresh This Scene</b> reads the scene&rsquo;s column in the Google Sheet again and brings in anything that
          changed — including <b>row 8</b>, the media actions — then starts the conversation afresh.
        </p>
        <p>(The tour won&rsquo;t press it: it would read your real sheet.)</p>
      </>
    ),
  },
  {
    title: '2 · A new action appears',
    group: GROUP,
    open: LIBRARY,
    run: 'refresh-demo',
    body: (
      <p>
        Say you added &ldquo;{DEMO_NEW_ACTION}&rdquo; to row 8 and refreshed (the demo pretends you did). The new action
        is now in the <b>Connect with Action</b> list, ready to connect.
      </p>
    ),
  },

  // --- 3 · The timeline ------------------------------------------------------
  // where each connected action happens — its stages, and its section of the room.
  {
    title: '3 · The timeline: stages',
    group: GROUP,
    run: 'media-begin',
    target: 'timeline-ruler',
    open: ['process-media'],
    body: (
      <>
        <p>
          The timeline is divided into the scene&rsquo;s <b>conversation stages</b> — the same stages made when the
          conversation was generated (here: Welcome, Check symptoms, Reschedule, Medication, Goodbye).
        </p>
        <p>
          Media actions are placed on these stages. A bracket marked <b>or</b> shows stages that are alternatives — the
          conversation takes one of them.
        </p>
      </>
    ),
  },
  {
    title: '3 · The room’s 11 sections',
    group: GROUP,
    run: 'media-begin',
    target: 'room-diagram',
    open: ['process-media'],
    body: (
      <p>
        The room has <b>11 projection sections</b>, numbered in this drawing. Each picture or video shows in the section
        its bar is on in the timeline below — and appears here as a preview when it plays.
      </p>
    ),
  },
  {
    title: '3 · Visual tracks 1–11',
    group: GROUP,
    target: 'timeline-area-1',
    open: ['process-media'],
    run: 'media-area-tracks',
    body: (
      <>
        <p>
          The numbered tracks <b>1–11</b> are the room&rsquo;s sections: a bar on track 3 plays in section 3.
        </p>
        <p>
          Each number has an arrow that opens <b>five tracks</b> for that section (3, 3.2 … 3.5), so up to five visual
          actions can sit in the same section at the same stage. A section shows one at a time — the latest replaces the
          one before.
        </p>
      </>
    ),
  },
  {
    title: '3 · Sound tracks',
    group: GROUP,
    run: 'media-begin',
    target: 'timeline-sound',
    open: ['process-media'],
    body: (
      <p>
        Sound has its own track, <b>♪</b>, at the bottom. Its arrow opens up to <b>five sound tracks</b>, so five sounds
        can play within the same stage. Sound is kept separate from pictures and video.
      </p>
    ),
  },
  {
    title: '3 · The blue bar',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-show',
    body: (
      <p>
        Each connected action is a blue bar: <b>which stages</b> it covers (left to right) and <b>which section</b> of
        the room it shows in (its track, 1–11).
      </p>
    ),
  },
  {
    title: '3 · Move through the stages',
    group: GROUP,
    target: 'timeline-next',
    open: ['process-media'],
    run: 'timeline-nav',
    body: (
      <p>
        <b>◀ ▶</b> step the playhead back and forward through the stages (or click a stage, or drag along the top).
        During a conversation the playhead follows the stage the conversation is in.
      </p>
    ),
  },

  // --- 4 · Editing the timeline ----------------------------------------------
  // stretching, moving, duplicating and deleting bars.
  {
    title: '4 · Change its length',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-stretch',
    body: <p>Drag either end of a bar to stretch it across more stages, or shorten it.</p>,
  },
  {
    title: '4 · Move it to another section',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-move',
    body: (
      <p>
        Drag the middle of a bar up or down to move it between tracks 1–11 — here to <b>3</b>, so the picture now shows
        in section 3 of the room drawing (left or right moves it to other stages).
      </p>
    ),
  },
  {
    title: '4 · Duplicate it',
    group: GROUP,
    open: LIBRARY,
    run: 'bar-duplicate',
    body: (
      <p>
        Hold <b>Option</b> while dragging a bar to <b>duplicate</b> it: the bar stays, and a copy goes where you let go
        — here track 6. The same action now shows in sections 3 and 6 at once.
      </p>
    ),
  },
  {
    title: '4 · Move a sound between tracks',
    group: GROUP,
    open: LIBRARY,
    run: 'sound-tracks',
    body: (
      <p>
        With the ♪ tracks open, drag a sound bar between them — here the ding moves to the second sound track, leaving
        the first free for another sound at the same stages. Sound bars move along the stages like any bar.
      </p>
    ),
  },
  {
    title: '4 · Deleting a bar',
    group: GROUP,
    open: LIBRARY,
    run: 'delete-copy',
    body: (
      <p>
        A bar&rsquo;s <b>×</b> deletes it. With another bar still there (the duplicate&rsquo;s original), the connection
        stays.
      </p>
    ),
  },
  {
    title: '4 · Deleting the last bar',
    group: GROUP,
    open: LIBRARY,
    run: 'delete-last',
    body: (
      <>
        <p>
          Bars and connections are linked. Deleting <b>every</b> bar of an action removes its connection too: the
          picture is no longer connected to that action.
        </p>
        <p>
          Only the connection goes — not the scene, its conversation, or the action written in the sheet. Connect it
          again any time.
        </p>
      </>
    ),
  },
  {
    title: '4 · Disconnecting removes its bars',
    group: GROUP,
    open: LIBRARY,
    run: 'delete-connection',
    body: (
      <p>
        It works the other way too: disconnecting with the connection&rsquo;s <b>×</b> removes all its bars from the
        timeline. (⌘Z undoes either.)
      </p>
    ),
  },
  {
    title: 'That’s the media process',
    group: GROUP,
    run: 'media-begin',
    body: (
      <p>
        When you finish, the demo scene and its files are cleared away and your own media folder, library and
        connections come back. Open <b>Onboard Me</b> again any time.
      </p>
    ),
  },
];
