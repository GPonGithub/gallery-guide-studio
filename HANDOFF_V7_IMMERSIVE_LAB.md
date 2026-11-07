# v7 handoff — Immersive Lab development (Chatbot Designer)

Written 2026-10-19 to continue in a new conversation. **Read this file first.** For the detail of each
feature, read `HANDOFF_V6_IMMERSIVE_MEDIA.md` (§7a–7t — the v7 work is written up in §7t), then
`HANDOFF_V5_CHATBOT_DESIGNER.md` for older history. The shared show-file format is in `SHOW_FORMAT.md`.

---

## Latest — 2026-11-06 evening, studio Mac (read this first)

**Branch `v8`**, pushed to GitHub (`origin/v8`) at the end of 2026-11-06 with everything below. v6 is still the
live site; v8 is only a preview. Dev server: `npm run dev` on :3000 (in the Code app: the `gallery-guide-studio`
entry in `.claude/launch.json`). TouchDesigner file: **`F2026_StudioMap_r1.40.toe`** in
`Fall 2026 Grahams Work/TouchDesigner_Graham_Fall_2026/` (saved with everything below).

### Built 2026-11-06

1. **Local backup on this computer** (finished). `/api/local-backup` (GET/PUT `?team=ED|AE` →
   `.local-backup/team-ED.json`, atomic write, keeps `.previous.json`, localhost only) + `src/lib/localBackup.ts`
   + `LocalBackupNote.tsx` (mounted under the header in `page.tsx`). Saves 4 s after any change. If the browser
   has **no scenes** and a backup has some, it puts the backup back and shows a note; step 1 then names each
   scene's media folder to choose again. A copy with no scenes is never saved (client and server both refuse).
   **Caveat:** one backup per team per computer — the last browser to save wins. The Code app's browser pane
   holds an older copy of the scenes; with the app open there it saved over the Chrome copy twice today (put
   back from `.previous.json`). **Keep the app open in one browser only** (the user's Chrome); if a pane test is
   needed, `chmod a-w .local-backup` first and restore it after.
2. **Spatialized audio (step 6): the balance belongs to the sound.** Moving the dot sets `pan` on every bar of
   that sound in the scene and remembers it (localStorage `sound-pans`, key `sheet#scene|assetId`), so a bar
   added later starts there. The middle is stored explicitly. The Sound list shows each sound once.
3. **Record Movement / Delete Movement Recording** (step 6). ● Record Movement plays the sound (if it isn't
   already) and samples the dot every 40 ms against the file's time, until Stop Recording, the sound ending or
   looping. Saved as `MediaLink.panPath [{t,x,y}]` on all the sound's bars + localStorage `sound-pan-paths`
   (holds compressed to their ends). On playback the position follows the path (`panAt`, interpolated) in the
   browser and is sent to TouchDesigner (`sound pan`, at most every 80 ms, only when it moved). While a sound has
   a recording its dot can't be dragged by hand. Fixed: the dot only follows the pointer while the button is held.
4. **Fades on timeline bars.** Bar ends are 16 px (were 8); bar contents are padded 20 px so thumbnails and ×
   clear them. **Click an end** (not drag) to switch its fade in (left) / fade out (right); a white ramp shows
   when on. **Fades are on by default** — `TimelineBar.fadeIn/fadeOut` are on unless `false`
   (`fadesIn()/fadesOut()` in `mediaFolder.ts`); applies to existing bars too. `FADE_SECONDS = 1`.
   - Pictures/video/colours: `Shown.fadeIn/fadeOut` → `media show/play` and `media hide` carry `"fade": 1`.
     Clearing (restart, scene change) is immediate.
   - Sounds: browser fades its own volume (`fadeTo` in `mediaPlayback.ts`); `sound play/stop` carry `fade`.
   - **Marker moves are now per area** (`markerPlay.ts`): an area whose bar carries on into the next stage is
     left alone even when the same file/colour ends or starts on another area (before, the whole file was
     re-shown, so it faded again). `showVisual(..., only: true)` changes only the named areas.
5. **TouchDesigner fades** (`build_immersive_lab.py` + `Claude/TouchDesigner/add_fades.py`, run and saved in
   r1.40): a `levelTOP fadeN` between `placedN` and `areaN`; the receiver eases `brightness1` (or a sound slot's
   volume) with an expression only while fading, then back to a constant. Test without the app: POST
   `{"type":"media","action":"hide","area":11,"fade":4}` to :9980 → reply "fading out". `fade_check.py` /
   `fade_measure.py` read it frame by frame.

### Known problem: TouchDesigner slows down over hours
After a restart it runs at 60 fps; after ~5 h it was down to ~20 fps (video jerky, fades visibly stepped). The
GPU time at `MAPPER/projectorBlend/in1` grows while it runs — root cause **not found yet**. Restarting fixes it
for a few hours: TouchDesigner ▸ Quit, `open .../F2026_StudioMap_r1.40.toe` (opens one copy), then POST
`{"type":"projectors","action":"open"}` to :9980 to reopen the 4 projector windows. Check with `fade_measure.py`
(every frame = 60 fps) or the FPS readout in TD's top bar. Finding the leak is the main open job.

### Next steps
- Find why TouchDesigner slows down over time (above).
- Listen to recorded movements and fades in the room (sound fades in TD not yet heard by anyone).
- Optional: share one movie player when a video is on several areas; convert the 25 fps nurses video to 30 fps.
- The room drawing in the app doesn't show fades (only the projectors and speakers fade).

---

## Earlier — 2026-11-05/06 on the studio Mac

**Branch `v8`**, studio Mac (`ixdstudio`): `70b1cb4` Spatialized audio · `9fe01bf` video converter groundwork ·
`8298804` sounds volume/limiter, stage clicks, room numbering. (The local backup that was half built here was
finished on 2026-11-06 — see above.)

**Why the backup:** this Mac's Chrome is cloud-managed by the school with an **ephemeral profile**
(`Local State` → `Profile 167`, `is_ephemeral: true`). Quitting Chrome wipes all of the app's browser storage:
media lists (incl. made colours/text), folder handles and permission, connections, saved scenes, settings,
API keys. Symptom: timeline bars come back from the scene but thumbnails are black. Long-term fix is IT
turning off `ForceEphemeralProfiles` in the Google Admin console (user to ask). Don't tell the user to quit
Chrome.

**Built this round (committed):**
- **Immersive Media step 6 · Spatialized audio** (`SpatialAudioPanel.tsx`, `spatialAudio.ts`): clicking a sound
  bar opens it (`pickSpatialSound`, `CollapsiblePanel.openRequest`). Square with a speaker per corner and a
  draggable dot; equal-power levels (corner = only that speaker, middle = all four at 0.5). Saved as
  `MediaLink.pan {x,y}` (-1..1, y+ = front), with Undo. Labels shown are the **room's numbering**: front left 3,
  front right 4, back left 2, back right 1 (`SPEAKERS[].label`); routing goes by **output number** `n` (output 1
  front left, 2 back right, 3 back left, 4 front right). Changing labels must not change `n`.
- **Browser playback to 4 speakers** (`mediaPlayback.ts`): every timeline sound goes through Web Audio → mono →
  4 per-speaker gains → limiter (4 mono DynamicsCompressors, −3 dB, 20:1) → `AudioContext.setSinkId` to the
  GIGAPORT eX (needs Chrome to name devices: mic permission; "Use the room's speakers" button asks). Chrome
  shuffles channels on the GigaPort, found by ear: `BROWSER_CHANNEL_FOR_SPEAKER = [2, 0, 1, 3]` — re-check by ear
  if the Mac's output or speaker setup changes (it was found with the GigaPort as macOS output; the Mac's output
  is now Loopback Audio 3 again).
- **Volume**: Music / Sounds panel has its own **Sounds volume** (straight, default 100%; was the music's squared
  Volume, 25% at 5), Music volume, Dip (both). Bar slider 0–400% (`MAX_SOUND_VOLUME = 4`); TouchDesigner clamps
  at 4 (no limiter there). macOS GigaPort channels are 100%, nothing muted.
- **Stage clicks**: moving the marker by hand passes `ask: true` (Chrome may ask for folder permission) and a
  sound that fails shows a red note at the top of the timeline (it used to fail silently).
- **Short sound bars**: stretch handles pinned to the bar edges; volume control and thumbnail shrink first.
- **TouchDesigner**: build script makes a 4-speaker network (`build_spatial`: per slot mono → `sp_pan{k}`
  levels → 4 buses → `audio_out` on the GIGAPORT, outputs 1–4); receiver handles `sound pan` and `pan` on
  `sound play`. Installed in the running StudioMap with `Claude/TouchDesigner/add_spatial_audio.py`
  (no rebuild); **the .toe isn't saved** and nobody has listened to it yet. TD's audio_out must stay on the
  GigaPort, not Loopback/default (or sound doubles).
- **Video converter** (parked, groundwork only): `/api/media/convert` (ffmpeg → H.264 1080p or HAP Alpha),
  TD `media reload`, Media Library skips `Originals before H.264/`. Still to do: codec check in the browser,
  queue + progress on thumbnails, write the file back and move the original.

**The room's audio (outside the repo):** 4 speakers on the GIGAPORT eX (8 outputs). macOS output = Loopback
Audio 3 (Pass-Thru L → GigaPort 1+3, R → 2+4), set up by the speaker session; notes in its
`gigaport-4-speaker-setup.md`. GigaPort's macOS speaker layout labels outputs 1–4 L/R/Ls/Rs
(`Claude/TouchDesigner/gigaport_speaker_layout.swift`; `swift <file> restore` undoes) — without it Chrome folds
4 channels to stereo.

---

## 0. Where things stand

- **Branch `v8`** (made 2026-10-20 from v7 `3e7e028`) is now the working branch — everything below, plus
  the timeline bar thumbnails, stacked labels and overlap stripes. Its Vercel preview:
  https://gallery-guide-studio-git-v8-gpongithubs-projects.vercel.app/agent (sign in to Vercel to open).
- **Branch `v7`** was the working branch (pushed to GitHub, `GPonGithub/gallery-guide-studio`).
  Latest commit **`c3a5bfa`**. v7 was made from v6 `baa00af`.
- **Branch `v6`** is still what the **live site** deploys: https://gallery-guide-studio.vercel.app/agent.
  Pushing v7 only makes a Vercel *preview*. To go live: merge v7 into v6 (or point Vercel's production
  branch at v7) — only when the user asks.
- **Export Project / Import Project** buttons — committed in `df0ce7c` (on v7 and v8).
- **Never commit**: the two personal PNGs in the repo root (`APPOINTMENT FLOW CHART_05.png`,
  `Screenshot 2026-08-12 at 5.36.21 PM 2.png`) and the `student-guide/` folder (its screenshots show the
  example sheet's patient details; the PDF is handed to students directly).
- Run locally: `npm install`, `npm run dev` → http://localhost:3000/agent. Often another session's dev
  server is already running on :3000 — use it (open the URL in the browser pane) rather than starting one.

## 1. Working conventions (the user's)

- Commit / push **only when asked**; push to **v7** (v6 only if the user says so — it deploys live).
- Never type the user's API keys or passwords. Test keys only, and never real ones in screenshots.
- Don't run prettier on `src/app/agent/page.tsx` (hand-formatted). New files:
  `npx prettier --single-quote --print-width 120`.
- Keep usage lean: batch small tweaks; for simple visual changes check `npx tsc --noEmit -p .` and eslint
  and ask before an in-browser test. Bigger behaviour changes: test in the browser pane.
- The user prefers clear, non-technical explanations; offer choices as clickable questions.
- The user is a designer: prioritise **their interface design**; Greg's work is adopted behind it
  without contradicting the UI.

## 2. The alignment with Greg's Show Control (the v7 plan)

Greg Cowley's `imr-showcontrol` (local copy: `~/Documents/2. Post Snibbe/0. CCA Teaching/2026 Fall/
1. Connected Hospital Project/1. Gregs Show Control Code/imr-showcontrol-main`) is a Vite/React
"Director-style" show tool with a desktop (Electron) shell and a TouchDesigner reader that watches
`show.json`. The user's decisions:

| Topic | Decision |
|---|---|
| Room | Keep **11** projection areas (the user's drawing); Greg's 10 to be updated |
| Shared format | `show.json` = **superset of Greg's** (cast / score.regions / playhead + our stages, actions, timing) |
| TouchDesigner | **Both**: reads the show file itself, and our live WebSocket link for conversation moments |
| Front end | Text & colour content ✅, Save/Open show ✅, drag onto timeline ✅, **scrub previews the room** (to do), drag onto the room drawing (to do) |
| Saving | show.json **inside the media folder** ✅ |
| Greg's access | **Shared GitHub repo**, his own branch |
| Desktop app | Greg's kiosk shell later, pointed at our app's URL |

Greg's show-control deploy to Vercel was attempted (Vercel Drop) but **never completed** — the user
must click Deploy themselves (publishing was blocked for the assistant).

## 3. Built on v7 (commit `c3a5bfa`) — see HANDOFF_V6 §7t for files and details

1. **Show file** — `show.json` autosaved into the media folder (needs one "Allow Saving"); Save a Copy /
   Open Show (Adding Immersive Media → 3 · Show file). `lib/agent/showFile.ts`, `showSave.ts`,
   `ShowFilePanel.tsx`, `SHOW_FORMAT.md`.
2. **Text & colour items** — Media Library → Make + Text / + Colour; shown in the room drawing, sent to
   TouchDesigner (build script has colour + text layers — **the user must re-run the build script in TD**),
   saved in the show file; never written to the sheet's Media tab.
3. **Drag onto the timeline** — library rows drag onto matching rows (sounds → ♪ tracks, the rest →
   areas 1–11) as dashed, unconnected bars; **▼ on a bar** connects it to an action.
4. **Play on marker arrival** — reserved action `@marker-arrival`: plays while the timeline marker
   (playhead) is on the bar's stages — at call start, as the conversation moves, or when the marker is
   moved by hand. `lib/agent/markerPlay.ts`.
5. **When it plays on each bar** — the bar's ▼ panel also sets kind / loop / every-time event / voice.
6. **Scene buttons in the chat toolbar.**
7. **Apps Script "Run + Allow"** step in the in-app setup list and the chatbot onboarding tour.

## 4. Built on v6 this session (all pushed; v6 = live)

- `4db4a27` Team ED / Team AE toggle (separate storage per team: `lib/team.ts`).
- `f695f3e` TouchDesigner media link: `public/touchdesigner/build_immersive_lab.py` (builds
  `/project1/immersive_lab`: WebSocket receiver on 9980, area1–11 outputs, 8 audio slots, tables
  message_guide / message_log / now_playing / media_list, numbered preview), `lib/agent/touchDesigner.ts`,
  section 4 · TouchDesigner (Connect, Sounds play on, test panel).
- `f34a557` → `80f13c1` Adding Immersive Media onboarding tour: now **10 steps** in a student's order,
  demo sandbox (`lib/agent/mediaDemo.ts`, `public/onboarding-media/`), card stays put per area.
- `beaf940` Draw All Scenes to FigJam (step 2, stacked under Board Selected).
- `baa00af` Timeline ruler shows stage names; goal in the tooltip.

## 5. Outside the repo

- **TouchDesigner project**: `…/1. Connected Hospital Project/TouchDesigner/11 Video Channels_01.toe`
  (TD 2025.33230, Non-Commercial → 1280×1280 cap). Build script copied beside it. Run in the Textport:
  `exec(open('…/TouchDesigner/build_immersive_lab.py').read())`. The Textport window opens on the
  user's **MB16A** monitor. TD 2025 names: Movie File In loop = `textendright` (cycle/hold); Audio File In
  `repeat` (off/on). Keep the script pure ASCII.
- **Media folder**: `…/1. Connected Hospital Project/1. Conversation App Media Folder` (21 files, flat).
- **Example Google Sheet** (students copy it): `docs.google.com/spreadsheets/d/1Lfn5p0QtZKlrQ2527x3i83Sntkkp8CYviAWrcGUpZ_k`
  ("Copy of Voice Assistant Script_01_For Nathan" — confirm with the user it's the right one to share).
- **Student guide PDF**: `student-guide/Chatbot Designer - Student Guide.pdf` (built from
  `student-guide/guide.html` + `img/`; re-export with headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="Chatbot Designer - Student Guide.pdf" "file://$PWD/guide.html"`).
  Open questions for the user: the example sheet link; real steps for getting an Anthropic key.

### 5a. Studio Mac (user `ixdstudio`) — set up 2026-10-22

- Repo cloned to `~/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/gallery-guide-studio` (v8).
  Node installed with Homebrew (`/opt/homebrew/bin`).
- **TouchDesigner file**: `…/Claude/TouchDesigner/11 Video Channels_01.toe` — Immersive Lab built and
  **saved** in it (the copy brought over had never been saved with it). The build script copy beside it has
  `MEDIA_FOLDER` set to this Mac's `…/Fall 2026 Grahams Work/1. Conversation App Media Folder`; the repo copy
  still names the other Mac's `/Users/grahamplumb/…` path, so run the local copy (or fix Media Folder on
  `immersive_lab`).
- Tested: the **v8 Vercel preview in Chrome** connects to `ws://localhost:9980` and shows media in the areas
  (browser → TouchDesigner directly; Vercel isn't involved). TouchDesigner found 21 of 26 library items — the
  5 missing ones not yet checked.
- Textport tip: after typing or pasting a line, Return sometimes needs pressing a second time. To read what
  arrived: `print(op('/project1/immersive_lab/message_log').text)` in the Textport.

## 6. Next steps

1. **Commit** Export / Import Project (ask first).
2. **Scrub previews the room** — stepping the timeline marker shows each area's state at that stage
   (hold-until-replaced), without playing the conversation. Marker arrival already does this for
   "on marker arrival" connections; extend to a preview of everything.
3. **TouchDesigner reads show.json by itself** (Text DAT Sync to File + JSON DAT, as Greg's reader does),
   alongside the live link; extend the build script.
4. **Drag onto the room drawing** (drop media straight onto an area).
5. Update Greg's tools for 11 regions; give Greg access (shared repo, his branch).
6. Later: Greg's kiosk shell on the room machine; physical inputs (Zigbee buttons, BLE positions) as
   new trigger kinds next to the conversation.
7. Still untested with real keys in Chrome: Claude's action readings and moment judgements,
   talk-to-interrupt with a real mic, the Music/Sounds dip, the Apps Script Media tab (needs the
   re-deployed script).

## 7. Testing tips

- **Browser pane**: show it (`show_pane preview`) before trusting animation/rAF results; set the
  viewport to 1440×900 for layout checks; screenshots there are tiny — measure with JS instead.
- **The media tour's demo** (Adding Immersive Media → Onboard Me) is the quickest sandbox: a demo scene,
  three demo files and actions. Hide its card with JS (`[data-tour-ui]` display none) to drive the UI;
  closing the tour restores the student's folder, library and connections.
- **Fake TouchDesigner**: a tiny Node WebSocket server on :9980 that logs messages (see the v6 session),
  or `curl -X POST localhost:9980 -d '{"type":"hello"}'` against real TD.
- **The user's Chrome** (Claude in Chrome) holds their real scenes — use it only for screenshots, never
  type keys; it's at http://localhost:3000/agent (team ED).
- Never open the IndexedDB `goal-agent-studio` from a page other than `/agent` with a fixed version —
  it creates an empty DB without stores (fix: delete it and load `/agent`).

## 8. To start the new conversation

Paste this as the first message:

> Continue developing the Immersive Lab Chatbot Designer on branch **v8** in this project. First read
> `HANDOFF_V7_IMMERSIVE_LAB.md` in the project root in full, starting with "Latest — 2026-11-05/06".
> Tell me briefly where things stand (including what's uncommitted) and ask what I'd like to work on next.
> Don't change anything until I ask.

Next up when continuing: finish the local backup (see "Uncommitted right now" at the top), then listen to
TouchDesigner's 4-speaker output and save the StudioMap .toe if the user wants, then push v8 when asked.
