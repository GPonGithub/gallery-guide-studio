# v6 handoff — Chatbot Designer: Adding Immersive Media

Written 2026-10-17, updated 2026-10-18, to continue in a new conversation. Read this first, then
`HANDOFF_V5_CHATBOT_DESIGNER.md` for everything older (sheet rows 1–7,
patients & memory, row-7 saving, FigJam, onboarding tour, hosting).

## 0. Where things stand

- **Branch `v6`** is the one to work on (the user's instruction). **Never
  push to v5** (`v5-hosted` stays at `1f0a8a9`; tag `v5-final` is older).
- **Live site** https://gallery-guide-studio.vercel.app/agent — Vercel
  production tracks `v6`, so **every push to v6 deploys**.
- **Everything below is committed and pushed** (2026-10-18 session: room
  previews + triggers (§7–7b), chatbot knows the room's media (§7d, 7h),
  interrupting (§7e, 7k), Music / Sounds (§7c), bars: delete / duplicate /
  undo / empty-space placement / follow "When it plays" (§7f, 7i, 7m, 7o and
  the notes after them), sound and area sub-tracks, looping, rewording,
  toolbar and library layout). See `git log` for the commit. Earlier commits:
  `4a29b99` (timeline header), `6b2bad0` (npm install button), `dff752e` (the
  big immersive-media commit).
- **Not yet tested with real keys** (the user tests in their Chrome): Claude's
  real readings and moment judgements, the agent going along with the room,
  talk-to-interrupt with a real mic and ElevenLabs voice, Music / Sounds levels
  on real sounds. Also: the user hasn't yet re-deployed the Apps Script (§4).
- Run locally: `npm install` then `npm run dev` → http://localhost:3000/agent
  (`.claude/launch.json` has the `gallery-guide-studio` preview config; the
  desktop app stops the server after a while — just start it again. Note `/`
  locally is the older playbook studio; always open `/agent`).

### Working conventions (from the user)
- Commit / push **only when asked**; push to **v6 only**.
- **Never commit** the two personal PNGs in the repo root
  (`APPOINTMENT FLOW CHART_05.png`, `Screenshot 2026-08-12 … PM 2.png`).
- Never type the user's API keys or passwords; the hosted copy never uses
  server keys.
- Formatting: new files were run through
  `npx prettier --single-quote --print-width 120`. **Don't run prettier on
  `src/app/agent/page.tsx`** (hand-formatted; doing so once produced a
  400-line noise diff that had to be unpicked).
- Testing in the built-in browser pane: when the pane is **hidden**,
  `requestAnimationFrame`, CSS transitions, smooth scrolling,
  IntersectionObserver and ResizeObserver don't run — show the pane
  (`show_pane preview`) before trusting thumbnails/scroll results. A media
  folder can be faked with OPFS (`navigator.storage.getDirectory()` →
  stub `window.showDirectoryPicker`), and IndexedDB `goal-agent-studio` /
  store `media` can be seeded directly. Restore any test data afterwards.

## 1. The layout now

- **Design Process** column (left), then — while **Adding Immersive Media
  Process** is open — the **middle media panel**, then the **chat**, then the
  Inspector strip.
- Process sections each have an **Onboard Me** button at the right of their
  heading. Chatbot Generation's starts the existing 28-step tour (pulses
  until first clicked); Adding Immersive Media's is disabled ("coming soon").
- **Chatbot Generation Process** sections (renumbered this session):
  1 Generate scenes from Google Sheet · **2 FigJam board (optional)** (moved
  from 6) · 3 Describe the conversation · 4 Can use · 5 Saved · 6 Cannot use ·
  7 Bring your edits back. Internal `data-tour` ids were left as they were
  (FigJam is still `design-6`).
- Dividers are 4px black lines, Saved-green (#15803d) while held:
  Design column border, media/chat border, diagram/timeline border, Media
  Library list bottom edge.
- **Chat folding**: dragging the media/chat border to the far right (chat
  < 150px) hides the chat; a black **Chat** tab appears under **Inspector**;
  clicking it reopens the chat at 400px. Remembered (`media-chat-hidden`).
  Closing the media panel always shows the chat.
- Scene buttons were **removed from above the chat**; they now sit centred
  **above the room drawing** (and still in Design Process sections 3–6).

## 2. Adding Immersive Media Process (left column)

**1 · Media folder**
- Choose Media Folder / **Refresh Media** (browser folder picker — Chrome/Edge
  only; handle remembered in IndexedDB). Scans subfolders; images, video,
  sound by extension (`lib/agent/media.ts` `kindOf`).
- IDs `M-001…` are stable: matched by path; new files get the next number;
  missing files are kept and marked missing; a returning file gets its old ID
  (`mergeMedia`). The sheet's list is read first so its IDs win.
- Writes the sheet's **Media** tab via the Apps Script (see §4). The script
  finds columns **by heading** (the user's tab: ID #, File name, Path, Type,
  Status (present/missing), Date Added; other columns untouched).
- **Run npm install** button (below Refresh Media, same 190×36 style) with a
  status line "✓ Video thumbnails ready" / "need ffmpeg". POST
  `/api/media/ffmpeg` runs plain `npm install` — local only, same-origin
  only; result message closes with ×.

**2 · Media Library**
- Loads when opened (asks folder permission from that click). Scrollable
  list; each row: 176px thumbnail, ID · type, filename, Added date, and a
  40px **Connect with Action ▾** button aligned to the thumbnail's bottom.
- Arrange row: Listed · Most recent · Name · Video · Sound · Image, plus a
  search box (closest matches first: exact, prefix, word-prefix, contains/ID,
  letters in order). List height drags down to the window bottom.
- Thumbnails: images/video first frame; video click plays/pauses; sound
  shows ♪ Sound, click plays, **■ stops** (rewinds). Sound playing from a
  Try it or a conversation also shows ■ there and can be stopped.
- Video Chrome can't decode (e.g. ProRes 4444 + alpha) → first-frame PNG via
  **ffmpeg** (`/api/media/thumbnail`, alpha kept), cached in IndexedDB
  (`thumb:<id>`), labelled "Still · plays in TouchDesigner". ffmpeg comes
  from the **`ffmpeg-static`** dependency (fetched by `npm install` per
  platform; `lib/ffmpeg.ts` looks there first). Not available hosted (501).
  Homebrew on the user's Mac is an unsupported Intel-prefix install with
  outdated Command Line Tools — don't rely on it.

## 3. Media actions (sheet row 8) and connections

- **Row 8 "Media Actions in this Scene"**: one action per line per scene
  column; column B (All scenes) lines are added to every scene (like rows
  3–6). Parsed in `lib/agent/sheetScenes.ts` (`mediaActions`, `actionLines`).
  Read **live** when the Media Library opens, the scene changes, and **every
  click of Connect with Action** ("Checking the sheet…" sits on the title
  line so the dropdown doesn't change height). Row 9 "Media in this Scene"
  exists in the sheet but isn't used yet.
- Currently in the sheet: Scene 4 has the actions (Maya picture, heart
  monitor video, ding every time before you speak, background soundscape
  throughout scene); column B has an unfinished line ("Play somecalm
  background music throughout the scene. Use the") that appears in every
  scene.
- **Connections** (`MediaLink` in `lib/agent/mediaFolder.ts`): file ↔ action
  text, per sheet + scene number; optional `timing` override, `assetName`,
  `assetKind`, and `bar` (timeline placement). Kept in IndexedDB (`links`),
  shared live between the Media Library and the timeline through a small
  store (`useMediaLinks` / `updateMediaLinks`). Dropdown closes on outside
  click / Escape. The blue connection box shows scene, action, kind badge,
  timing controls, ▶ Try it (→ ■ Stop) and a 32px × to disconnect.
- Reworded actions: `followRewording` moves a connection to the line that
  contains its old words or shares most of them (≥0.6), keeping settings.

## 4. Apps Script (the user must re-copy it once)

`lib/agent/sheetScript.ts` gained `readMedia` / `writeMedia` (Media tab
only, columns by heading). **The deployed script in the user's sheet is
still the old one** until they: section 1 → Copy the script → Extensions →
Apps Script → paste → Deploy → Manage deployments → edit → **New version**.
The app reports "needs updating" if it's old. Script still writes row 7
(saved info) and nothing else besides the Media tab.

## 5. Action timing and playback

- **Kinds** (`lib/agent/media.ts` `ActionKind`): `once` (a moment), `every`
  (repeating event), `throughout` (whole scene), `start` (once when the call
  begins), `end` (once when it ends). `every` also has `when`: before-reply /
  reply-start / after-reply / caller-speaks, and `voice`: wait / over /
  delay n s. Labels: `KIND_BADGE`, `KIND_HELP`, `WHEN_LABEL`, `VOICE_LABEL`.
- **How a connection's timing is decided** (`timingOf` in `mediaFolder.ts`):
  the words (`readActionTiming`, an English phrase list — the offline
  fallback, now wide: during / for the whole… / loop / background / at the
  start / when the call begins / at the end…) → overridden by **Claude's
  reading** of the line (§7) → overridden by the **student's own choices**
  (`link.timing.kind / when / voice / delay`).
- **Playback** (`lib/agent/mediaPlayback.ts`), sounds only, stereo through
  the computer:
  - every: `soundsFor` / `playEvent` in `page.tsx` `sendTurn` — before-reply via
    the speech queue's `beforeFirst` hook (voice waits), reply-start on first
    `onPlay`, after-reply on quiet, caller-speaks when the caller sends.
  - throughout: `startLoop` when the call begins (first turn: Agent speaks
    first / first message), loops at 0.8 volume, `dipLoops(speaking)` → 0.3
    while the chatbot speaks (alongside the music duck), `stopLoops()` after the
    final goodbye, on Refresh this scene / Complete restart / new flow, and on
    scene change (effect on `saved.projectId`).
  - start: `sceneSounds(scene,'start')` once at call start; end: once after the
    goodbye of the reply that ends the call (`endsCall` in `sendTurn`).
  - Every played sound gets a ♪ marker (`MediaMarker.tsx`, shows kind or
    event). Any playing sound can be stopped (thumbnail ■, Try it ■ Stop,
    `stopSounds`). The voice waits at most 15s for a sound.
- Four-speaker spatialisation is a future idea ("Speakers" setting).

## 6. Middle panel: room + timeline

- Room drawing: the user's Illustrator file "Immersive Rook Projection
  Outlines_02.svg" → `public/room/projection-room.svg` (outlines and numbers
  removed) with the 11 outlines redrawn on top from
  `lib/agent/projectionLayout.ts` (exact coordinates). Outline weight scales
  with the drawing (source weight 4 units), never below 1px.
- **Timeline** (`MediaTimeline.tsx`): columns = the open scene's
  conversation **stages** in code order (`sortStages`: 1, 2A, 2B, 3…), with an
  "or" bracket over alternative branches. 11 projection tracks + a **♪ Sound**
  track. Playhead per scene (by stage code), ◀ ▶, click/drag the ruler,
  arrow keys; it **follows the live conversation's stage**.
- **Bars**: every connection in the scene is a blue bar with the action's
  words (15px white text, ↻ for every-time). New bars: every/throughout span
  the scene, once = first stage; sounds on the sound track, visuals on the
  first free projection track. Drag ends to stretch across stages, drag the
  middle to move across stages/tracks (sounds stay on the sound track). All
  bars live on one layer so a dragged bar keeps its pointer capture. Rows
  have ~5px gaps.

## 7. Reading the student's intent — BUILT, needs a real-key test

The user's requirement: "the app needs to read the user's intent, and if it's
not clear, give the user options to pick" — students write actions in any
wording and **other languages**.

- `POST /api/media/intent` {actions, anthropicApiKey} → Claude
  `claude-haiku-4-5-20251001` (thinking off, temperature 0, zod
  `Output.object`) returns per line: kind, (when, voice for every), `clear`,
  and `options` when unclear. Student key from the app; server key only when
  local (`anthropicModel`); no key → 500 "Add your Anthropic API key…" and the
  app silently keeps the phrase-list reading.
- Client store in `mediaFolder.ts`: `readActions(lines, key)` (reads only
  unread wordings, de-duplicated), `readingNow(text)`, `useActionReadings()`,
  `readingsReady()`; cached in IndexedDB `media` → `readings` (by exact,
  trimmed wording). Called whenever row 8 is read in `ImmersiveMedia.tsx`
  (the key comes from DesignPanel's `anthropicApiKey`).
- UI: the action list shows Claude's kind (or "? Not sure"). The connection box
  has a **"When it plays"** dropdown (all 5 kinds) and, when Claude wasn't sure
  and the student hasn't chosen, **"Not sure when this should play — pick
  one:"** with Claude's options as buttons. Every-time keeps its event / voice
  / delay controls. ▶ Try it now works for sounds of any kind.
- Timeline: new bars — every/throughout span the scene, once/start the first
  stage, end the last stage.
- Tested in the browser with a placeholder key and a stubbed turn API:
  soundscape looped from call start, chime "At the start" played once, ♪
  markers shown, Refresh this scene stopped the loop; unclear reading showed
  the pick-one buttons and picking replaced them. **Not tested:** Claude's real
  reading (needs the user's key — it's in their Chrome; never type it) and the
  dip under a real ElevenLabs voice.

### Next steps
1. User tests in their Chrome (Scene 4 has the actions); then commit + push v6.
2. "Once, when…" moments (e.g. show Maya's picture when the nurse asks) —
   likely use the agent's moment detection (`/api/agent/moments`) or stage
   entry from the bar's placement.
3. Images / video → TouchDesigner per projection area (`MediaMessage` sketch in
   `media.ts`), and showing them in the room diagram.
4. Media inspector in place of the TouchDesigner window; onboarding tour for
   the immersive-media process; row 9 / per-project storage of connections.

## 7b. Media in the room diagram + "once, when…" triggers — BUILT (2026-10-18)

- **Rule (the user's):** media only plays/shows when the conversation triggers its
  action. Images/video preview in the room drawing, in the area = the bar's
  **track** on the timeline (`areaOf`, area 1 until it has a bar).
- **Fit:** media fills the rectangle around the outline (cropped, never
  stretched — `preserveAspectRatio slice` / `object-fit: cover`), then is cut to
  the outline by a clipPath. Areas 2, 5, 8 have **holes** for 3, 6, 9
  (`holes` in `projectionLayout.ts`, evenodd) so those stay white or show their
  own media; 5 and 10 already exclude the corners where 4 and 11 sit. Video plays
  muted (loops only for "throughout"); undecodable video falls back to the
  ffmpeg still. Area numbers get a white outline over media.
- **Store:** `lib/agent/mediaShow.ts` — `sceneMedia`, `showVisual`, `hideVisual`,
  `clearVisuals`, `useShowing`, `isShowing`.
- **Triggers:** `POST /api/media/moments` (Haiku, any language) gets the scene's
  "once" actions with SHOWING / NOT SHOWING and the exchange; returns show/remove
  per action. `page.tsx` `checkMediaMoments` runs it twice per turn: on the
  caller's line alone (so the picture appears as the reply begins) and after the
  reply (caller marked ALREADY CHECKED). "Once" sounds play / stop the same way.
  "Throughout" and "at the start" visuals show at call start; at the call's end
  "throughout" ones come down and "at the end" ones go up. Restart / new flow /
  scene change empty the room. ▣ markers in the chat ("shown in area 1",
  "removed from area 1").
- **Try it** for images/video in the connection box: "▶ Try it in area N" /
  "■ Remove".
- Tested in the pane with OPFS test files and stubbed turn + moments APIs:
  clipping of all holes/notches, show on "can I see her picture?", remove on
  "put it away", throughout video at start and removed at goodbye. **Not
  tested:** Claude's real judgment of the moments (needs the user's key).

## 7c. Music / Sounds button (2026-10-18)

The chat toolbar's **♫ Music** button is now **♫ Music / Sounds**. Its Volume
and Dip sliders set the scene's MP3 music (as before) **and every timeline
sound** (every-time, once, start/end, throughout loops): `setSoundLevels` /
`duckSounds` in `mediaPlayback.ts` ease each playing `<audio>` (0.4s down,
1.2s up, as the music does; volume = `levelToGain`, dip = `dipToShare`). The
old fixed loop levels (0.8 / 0.3, `dipLoops`) are gone. Try the dip works when
music or any sound is playing. Not heard in a real conversation yet.

## 7d. The chatbot knows the room's media (2026-10-18)

Problem: the agent refused ("I can't show pictures") unless row 3 mentioned the
media, conflicting with the media triggers. Now every turn sends `media`
(`RoomMedia[]` in `types.ts`: action, kind, showing) — the scene's row-8
actions **with a file connected** — built in `page.tsx` `startTurnStream`.
`runtime.ts` `responderSystem` adds an **IN THE ROOM** section (go along with
it naturally as it appears, never say it can't, never offer anything not
listed) and `analyse` lists it and never counts asking for it as OFF TOPIC.
Checked in the pane that the list and its showing flag reach the turn; **not
tested** with the real model.

## 7e. Interrupting the agent (2026-10-18)

Four ways: **✋ Interrupt** (replaces Send while the agent speaks), **Esc**,
**sending** a message while it speaks, and **talking over it** with the open
mic ("Talk to interrupt" in the Voice panel, `interruptByVoice`, default on).
`page.tsx` `interrupt()` stops the voice, frees the conversation, and cuts the
reply back to the sentences that had started playing (`SpeechQueue.heard`) +
" —", so the next turn's history shows where it was cut off. Turns are numbered
(`turnIdRef`); an interrupted or superseded turn never overwrites the chat or
`busy`. `OpenMic` listens through the agent's voice (`agentSpeaking`) and
interrupts on a phrase with ≥2 words not in the agent's text, or a stop word
(wait, sorry, stop…); the agent's echo through the speakers is ignored.
Tested in the pane with a stubbed tone voice (Esc and send-while-speaking cut
correctly; history right). **Not tested:** real talking over it (needs a mic +
ElevenLabs) — echo through room speakers may still mis-trigger; headphones
are surest.

## 7f. Deleting and duplicating timeline bars (2026-10-18)

- Each bar has a **×** at its right (before the stretch handle) to delete it.
  A connection's **last** bar deletes the connection (file disconnected from the
  action — otherwise auto-placement would just add a new bar).
- **Option (Alt)-drag** a bar's middle to **duplicate** it: the bar stays, a
  dashed "+" copy follows the pointer, and is added where it's let go (cursor
  shows copy while Option is held). Dropping where it started adds nothing.
- Data: `MediaLink.copies?: TimelineBar[]` beside `bar`; `barsOf(link)` gives
  all. `mediaShow.ts` `areasOf(link)` → every projection track of its bars, so
  a triggered picture/video shows on **all** those screens at once
  (`PlannedMedia.areas`, one object URL per area). Markers and Try it say
  "areas 1, 5 and 8".
- Tested in the pane: duplicate to 5 then 8, plain move still moves, Try it
  showed Maya in 1, 5, 8, × removed copy / original / last (disconnected).

## 7g. Refresh this scene = Update This Scene (2026-10-18)

The chat toolbar's **Refresh this scene** now runs Design Process section 3's
**Update This Scene**: re-reads the scene's column and the "All scenes" column
from the sheet (`refreshSceneFromSheet`), revises the conversation design with
anything new, and restarts the conversation. It still also clears what the
scene saved for the selected patient (memory + row 7). A scene with no sheet
and no description just restarts. Wiring: page's `updateRequest` counter →
`DesignPanel` runs `updateScene`; `DesignPanel.onUpdateProgress` → the button
shows "Updating…", a spinner and the same `ProgressLine`. Tested in the pane
with a stubbed generate (no sheet).

## 7h. Room and chatbot agree (2026-10-18)

Problem seen by the user: "play the scenery" put the video up (room's check
said show) but the chatbot refused — it judged the action's "when…" itself,
and row 3 didn't mention scenery. Now the caller's words are judged **once**
(`judgeCaller` in `page.tsx`, cached by history length + text, started with
the early turn at phrase-final) and **before the reply is written**:
`startTurnStream` waits for it (max 3s) and marks those media
`change: 'appearing' | 'removing'` in `RoomMedia`; sendTurn applies the same
judgement (`applyMedia`). The prompt says the room decides, never contradict
it, acknowledge APPEARING NOW / COMING DOWN NOW, and that row-8 media belong to
the scene even if the description, rules or goal don't mention them. Tested
with stubs (turn got `change: 'appearing'`; one judgement per caller line).

## 7i. Undo / redo for media work (2026-10-18)

⌘Z undoes, **⌘⇧Z or ⌘X** redoes (Ctrl on Windows) — ⌘X because the user asked
for it; it's left as cut inside text boxes or when text is selected. Covers
the media connections store only: move / stretch / duplicate / delete bar,
connect / disconnect a file, change when it plays. `updateMediaLinks(update,
label)` — a `label` makes it an undo step; label-less updates (auto-placing a
new bar, following a reworded action) fold into the last step. Stacks in
`mediaFolder.ts` (`undoMediaLinks`, `redoMediaLinks`, max 100, browser session
only). Notice "UNDO · MOVE BAR" in the timeline header for 2.5s
(`useHistoryNote`). Keys in `page.tsx`; skipped in input/textarea/select/
contenteditable. Tested in the pane. Not covered: design text, flow cards,
settings (text boxes keep the browser's own undo).

## 7j. Looping video, every-time visuals, rewording (2026-10-18)

- **Video loops** while on screen by default; a **Loop** checkbox per video
  connection (`MediaLink.loop`, false = play once and hold the last frame).
- **"Every time" pictures/video** now replay (from the start) at each of their
  events — before each reply, as it starts, after it, when the caller speaks
  (`everyVisuals` in `mediaShow.ts`, `showEvery` in `sendTurn`), and come down
  at the end of the call. Note "before each reply" also fires before the
  agent's opening line.
- **Reworded actions** (e.g. a spelling fix in row 8): row 8 is now also re-read
  when the app window regains focus (coming back from the sheet) and in
  `refreshSceneFromSheet` (Refresh / Update this scene, every scene of the
  sheet). `followRewording` keeps bars and settings but **drops the student's
  `timing.kind`**, so the new wording decides when it plays.
- Tested in the pane (stubbed sheet + intent): loop, restart per reply, rename
  on focus with bar kept on its track.

## 7k. Mic pickup + talk-to-interrupt switch (2026-10-18)

The user found the mic worse at picking them up since talk-to-interrupt.
Likely cause: after the agent finished, `OpenMic` skipped results up to the
current count — and a caller speaking straight away often had their first words
merged by Chrome into the in-progress phrase that began with the agent's voice,
so they were dropped. Now when the agent finishes (not interrupted) the
recognition session is stopped and restarts fresh, as before the feature.
Also a **"✋ Talk to interrupt: On/Off"** button on the open-mic status line
(right side, shown while the open mic is on) toggles `interruptByVoice` (same
setting as the Voice panel checkbox). Not tested with a real mic.

## 7l. Timeline header + chat toolbar layout (2026-10-18)

- Timeline header is one line: "Timeline · scene" left; "Stage 2 · name" then
  ◀ ▶ (now `h-4`, half height) right; less padding above/below (`mb-1`,
  workspace `pt-2 pb-2`).
- Chat toolbar: `buttonOutlineCompact` / `buttonBusyCompact` in `styles.ts`
  (px-2.5, tracking-wider) for Complete restart, Refresh, Music / Sounds,
  Voice. A container query (`@container`, `@[660px]:`) keeps Restart/Refresh
  left and sound right when it fits on one line; narrower, it wraps and every
  button aligns right. Checked at both widths in the pane.

## 7m. New bars go into empty space (2026-10-18)

`findSpace` in `MediaTimeline.tsx`: a new connection's bar tries its own stages
on each track (top first), then the same length at the nearest other stages,
then (pictures/video only) shorter down to one stage; only a full timeline
overlaps. Sounds keep their length on the sound track. Before, with no free
track at its stages it fell back to track 1 on top of another bar. Tested in
the pane (11 full tracks over stages 1–2B → once at 3A track 1, throughout
3A–3C track 2).

## 7n. "Once / Loop, when user instructs" + equal toolbar buttons (2026-10-18)

- "When it plays" dropdown: **Once, when user instructs** (`KIND_BADGE.once`)
  and **Loop, when user instructs** (`LOOP_WHEN_BADGE`; kind `once` +
  `MediaLink.loop = true`; not offered for images), then Every time /
  Throughout / At the start / At the end. The separate Loop checkbox is gone.
  `loopOf(link)` (mediaFolder): student's choice → for once, Claude's reading
  (`ActionReading.loop`, new in `/api/media/intent`) → the words
  (`wordsSayLoop`: loop, repeat, keep playing…) → otherwise once; other kinds
  loop while on. A "loop when" sound uses `startLoop` until removed. Rewording
  clears `loop` too. One undo step per change (`setPlays`).
- Chat toolbar: all four buttons `toolbarButtonWidth` (164px, centred), so
  wrapped they form two aligned columns; long voice names truncate. Panel
  wrappers are `relative flex` (the Music button sat 2px low). One-row
  breakpoint now `@[700px]`. Checked in the pane. The Music/Voice pair also wraps
  (`flex-wrap justify-end`), so a very narrow chat (300px) gets one right-aligned
  column of four instead of the pair sticking out past the left edge.

Refresh this scene also turns the open mic (and the click-to-talk mic) off.

Media Library: **Connect with Action** uses the studio's `DropdownArrow` (larger
▼), `px-3`, label wraps to at most two lines. Arrange row is now Listed · Most
recent · **With actions** (files connected to an action in the open scene first)
· Name · Video · Sound · Image, with the search box on its own line below.

## 7o. Several sound tracks (2026-10-18)

The ♪ row header has an arrow (▶/▼) that opens up to **5 sound tracks**
(`MAX_SOUND_TRACKS`; user's limit) — opening always shows all five; sound rows
are tinted light blue (and their ♪ labels blue) to mark audio; remembered in
localStorage `timeline-sounds-open`. Closed, every sound
shows on the one ♪ row. Track ids: `'sound'`, `'sound-2'`…`'sound-5'`
(`TimelineBar.track`). New sounds go to the first free sound track
(`findSpace` over `SOUND_TRACKS`); dragging moves sounds among the open sound
tracks. The tracks are layout only: when a sound plays still comes from its
action's timing. Playback isn't capped (Chrome allows ~75 media players a page).
Tested in the pane. "Remove" on the Try it button is now "Hide", same width.

Media Library connection boxes fold: each connection is one line by default
(▶ · the action · when it plays, e.g. "LOOP, WHEN USER INSTRUCTS"; red "? Pick
when" / "Not in sheet" when it needs attention; small ×). Click to open the full
controls (▼ Scene · … header folds it again). Which are open is remembered in
localStorage `media-open-connections`. Deleting a duplicated bar removes just that
copy (user's choice); the last bar disconnects.

Deleting a bar also takes its media out of the room drawing: from that bar's
screen (a copy), or everywhere (the last bar), keeping any screen the same file
still has a bar on for another action (`hideVisualExcept` in mediaShow); the
last bar of a sound also stops it. Tested in the pane.

Projection areas 1–11 each have an arrow (▶/▼) that opens five tracks for that
screen (5, 5.2–5.5; ids `'5-2'`… in `TimelineBar.track`, `areaOfTrack` maps them
to the area; `MAX_AREA_TRACKS`). Remembered in localStorage `timeline-areas-open`.
Closed, extra-track bars show on the area's row. A screen still shows one
picture/video at a time (the latest replaces it). New visuals fill the 11 main
tracks first, then extra ones. Tested in the pane. (Committed.)

Bars follow "When it plays": `MediaLink.barsKind` records the kind the bars were
laid out for; when `timingOf(link).kind` differs (dropdown, pick-one, Claude's
reading arriving, rewording) the timeline effect re-spans every bar of it on the
same tracks — every/throughout across the scene, end the last stage, once/start
the one stage it starts at. Links from before `barsKind` just adopt their current
kind (no move). Bars show ↻ (every time) or ∞ (loop, when user instructs).
Tested in the pane incl. undo.

## 7p. Team ED / Team AE (2026-10-18)

A **Team ED | Team AE** toggle (`TeamToggle.tsx`) sits left of Keys in the header;
the open team is filled black. Each team has its own copy of the whole app in
the browser — keys, scenes, conversations, patients, media folder and
connections, layout. `lib/team.ts` `TEAM_STORAGE_SCRIPT` (inline `<script>` in
`app/layout.tsx` `<head>`, runs before the app) patches `Storage.prototype` for
localStorage only: team AE's keys get a `team-AE:` prefix, team ED keeps the
original keys (so earlier work stays with ED); `studio-team` is the one shared
key. IndexedDB: AE uses `goal-agent-studio-AE` (`browserDb.ts`). Switching
saves the team and reloads. The old server-projects migration runs for ED only.
Still shared: the FigJam boards list (`src/data/figjamBoards.json`), the phone
test hand-off (`.data/phone-flow.json`) and, locally only, server keys from
`.env` as a fallback (the hosted site has none). The script is also run when
`lib/team.ts` first loads (imported first in `page.tsx`, and by `browserDb.ts`),
as a backup if the layout's copy didn't run — a long-running dev server didn't
pick up the layout change. Toggle centred in the header; both buttons white,
black on hover, the open team with Complete restart's 4px border. Switching
both ways tested in the pane (AE empty, ED's scene intact).

## 7q. TouchDesigner media link (2026-10-18)

- **TouchDesigner side:** `public/touchdesigner/build_immersive_lab.py` (also
  downloadable from the app). Run in TD's Textport:
  `exec(open('<path>').read())`. Builds `/project1/immersive_lab`: Web Server DAT
  `receiver` (port 9980, WebSocket + HTTP POST), callbacks in `receiver_callbacks`,
  11 chains movie→fit→switch(black)→`area1…area11`→`out1…out11`, `preview` layout,
  8 Audio File In slots → `mix` (gain from `level`→`level_lag`) → `audio_out`, and
  tables `message_guide`, `message_log`, `now_playing`, `media_list`. Custom pars:
  Media Folder, Port, Output Width/Height. Unknown parameter names are reported,
  not fatal. Script is pure ASCII (TD reads files as ASCII). TD 2025.33230:
  Movie File In loop = `textendright` cycle/hold; Audio File In `repeat` off/on.
  Built and tested in the user's `11 Video Channels_01.toe` (not saved by me):
  curl POSTs and the app's test panel over WebSocket showed media in areas 1, 2,
  3, 5, played a sound, filled all tables; missing file reported. Non-Commercial
  licence caps resolution at 1280x1280 (warnings only).
- **App side:** `lib/agent/touchDesigner.ts` — browser WebSocket to the receiver
  (works hosted too when TD is on the same computer; Chrome may ask to allow local
  network access). On connect: hello → ready (status light + media folder),
  medialist, clear, current room, levels. `mediaShow.changed` → `syncVisuals`
  (diff per area: show/play/hide). `mediaPlayback`: `tdSound` play/stop, `tdLevels`
  in `rampAll`, local audio muted when sounds play on TouchDesigner (still times
  the sound; plays locally while not connected). Settings in localStorage
  `touchdesigner-media` (per team).
- **UI:** Adding Immersive Media → **3 · TouchDesigner** (`TouchDesignerPanel.tsx`):
  steps, address + Connect, status, Sounds play on (This computer / TouchDesigner /
  Both), Test TouchDesigner (show/hide area, loop, play/stop sound, dip, full,
  clear, last reply).
- Tested against a stand-in WebSocket receiver: hello/ready, medialist, show,
  sound play/stop, levels, clear, auto-reconnect after reload.

## 7r. Adding Immersive Media tour (2026-10-18)

- Section's **Onboard Me** now starts a 30-step tour (`components/agent/mediaTour.tsx`,
  9 parts: timeline, media folder + Option⌘C path + npm install/ffmpeg types,
  Media Library, Connect with Action + settings + Try it, bars (stretch / move /
  Option-duplicate), sound + 5 sound tracks, linked deletion, ◀ ▶, Refresh This
  Scene with a simulated new row-8 action). Own progress key
  `immersive-media-onboarding`.
- **Sandbox** `lib/agent/mediaDemo.ts`: demo scene "Demo · Nurse Visit" (stages 1,
  2A, 2B, 3, 4; three row-8 actions), demo files `public/onboarding-media/`
  (video, picture, ding — made with ffmpeg-static) copied into OPFS and set as
  the media folder; student's `folder`/`library` saved in IDB `demo-backup` and
  restored on finish, Close, or next page load. Demo links (`sheetId
  onboarding-demo`) removed and undo history cleared at the end. ImmersiveMedia
  and the page's MediaWorkspace use the demo scene while `useMediaDemo()` is on.
- Restore safety (fixed after the user lost their folder in the panel): `endMediaDemo` puts the
  folder/library back **before** clearing `demo`, and the panel re-reads them on
  `useMediaFolderRevision()` (bumped on begin / end / recovery), not on demo on/off. `beginMediaDemo`
  shares one set-up promise (concurrent steps), never overwrites an existing `demo-backup`, never
  backs up the demo's own folder, and `endMediaDemo` waits for a set-up still running.
- **Now 10 steps + finish** (user asked for fewer, following a student's own order, no low-level
  dropdown detail): Welcome · Choose your media folder (Option⌘C + npm notes) · The Media Library ·
  Connect a file to an action · When it plays, and Try it · Sounds work the same way · The timeline ·
  Arrange a bar · Delete a bar · Refresh This Scene · That's it. The card visits three areas in turn
  (library column → timeline → chat toolbar). No TouchDesigner in this tour. Advanced detail (every-time
  options, five sound tracks, per-section tracks) could become a separate tour later.
- Card behaviour (OnboardingTour, both tours): placed once per step near its subject, then stays put
  (`pinned`, `placedFor`); the notch slides round the edge to each highlight, or an arrow line when no
  edge faces it (`connector`); `showBoth` outlines two things; smallest nudge if it would cover one.
- Tour helpers gained `move(handle, dx, dy, alt)` and `choose(select, value)`;
  `OnboardingTour` takes `progressKey`; the pointer clears on every step.
- Markers added: room-diagram, timeline, timeline-ruler/tracks/prev/next,
  timeline-area-N, timeline-sound, media-folder-button, media-npm, media-arrange,
  media-search, media-list, refresh-scene; `data-asset`, `data-connection`,
  `data-action-option`, `data-when-plays`, `data-bar`/`-index`/`-track`/`-end`/
  `-delete`.
- Tested in the pane step by step (connect, settings change, Try it, stretch,
  move to 3, duplicate to 6, sound to sound-2, deletes, nav, new action), plus
  cleanup on finish, Close and reload. Not watched visually at full size.

## 7s. Stage names on the timeline ruler (2026-10-18)

The ruler (now `h-14`, playhead block 36px) shows each stage's code with its generated **name** beneath
(9px caps, cut with … when narrow); the tooltip adds the stage's **goal**. `TimelineStage` has an
optional `goal`, passed from `page.tsx`.

## 8. Other open items

- The user hasn't yet re-deployed the Apps Script (§4).
- Onboarding tour for the immersive-media process (button placeholder only).
- Connections/library live in the browser only (not in the sheet / not
  per project); row 9 could hold them later.
- Hosted copy: no folder thumbnails via ffmpeg, no npm install button;
  TouchDesigner cues still not sent when hosted.

## 9. Key files (new or heavily changed in v6)

| File | What |
|---|---|
| `src/components/agent/ImmersiveMedia.tsx` | Media folder + Media Library panels, connections UI, timing controls, Try it, thumbnails, npm install button |
| `src/components/agent/MediaWorkspace.tsx` | Middle panel: scene buttons, room diagram, dividers, chat border |
| `src/components/agent/MediaTimeline.tsx` | Stage timeline, playhead, bars |
| `src/components/agent/MediaMarker.tsx` | ♪ markers in the conversation |
| `src/lib/agent/media.ts` | Kinds, IDs, merge, sheet rows, timing parse (regex) |
| `src/lib/agent/mediaFolder.ts` | Folder access, IndexedDB library/links/thumbnails, shared links store, followRewording |
| `src/lib/agent/mediaPlayback.ts` | Playing/stopping sounds, event sounds, loops (throughout), dipping |
| `src/app/api/media/intent/route.ts` | Claude reads each action's intent (any language) |
| `src/lib/agent/projectionLayout.ts` | The 11 projection outlines |
| `src/lib/ffmpeg.ts` | Finding/running ffmpeg |
| `src/app/api/sheets/media/route.ts` | Read/write the Media tab via Apps Script |
| `src/app/api/media/thumbnail/route.ts`, `src/app/api/media/ffmpeg/route.ts` | ffmpeg thumbnails; status + npm install |
| `src/components/agent/speechQueue.ts` | `beforeFirst` hook (voice waits for a sound) |
| `src/app/agent/page.tsx` | Media panel wiring, chat folding, sound events in `sendTurn`, `sayAndWait` |

Storage: IndexedDB `goal-agent-studio` v4 store `media` (keys `folder`,
`library`, `links`, `readings`, `thumb:<id>`); localStorage `process-open:<title>`,
`media-workspace-split`, `media-chat-width`, `media-chat-hidden`,
`media-library-height`.
