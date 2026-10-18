# v6 handoff — Chatbot Designer: Adding Immersive Media

Written 2026-10-17 to continue in a new conversation. Read this first, then
`HANDOFF_V5_CHATBOT_DESIGNER.md` for everything older (sheet rows 1–7,
patients & memory, row-7 saving, FigJam, onboarding tour, hosting).

## 0. Where things stand

- **Branch `v6`** is the one to work on (the user's instruction). **Never
  push to v5** (`v5-hosted` stays at `1f0a8a9`; tag `v5-final` is older).
- **Live site** https://gallery-guide-studio.vercel.app/agent — Vercel
  production tracks `v6`, so **every push to v6 deploys**.
- Last pushed commit: `6b2bad0` (Run npm install button, matching step
  buttons, larger bar text). Before it: `dff752e` (the big immersive-media
  commit).
- **Uncommitted right now** (two small UI changes, tested, ready to commit):
  - `MediaTimeline.tsx` — timeline header: scene title on top with ◀ ▶
    together on the right; "Stage 2A · Check in" on the line under the title.
  - `MediaWorkspace.tsx` — removed the 2px frame (and its inner padding)
    around the timeline so it's larger.
- Run locally: `npm install` then `npm run dev` → http://localhost:3000/agent
  (`.claude/launch.json` has the `gallery-guide-studio` preview config).

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

- Kinds: `once` (moment), `every` (repeating event), `throughout`
  (`lib/agent/media.ts`, `readActionTiming` — **a regex phrase list**).
  `every` has `when`: before-reply / reply-start / after-reply /
  caller-speaks, and `voice`: wait / over / delay n s.
- **Only `every` sounds play** today (`lib/agent/mediaPlayback.ts`
  `soundsFor`/`playEvent`/`playSound`; registry for stop; 15s max wait for the
  voice, sound plays on). Wired in `page.tsx` `sendTurn`: before-reply via
  the speech queue's new `beforeFirst` hook (voice waits), reply-start on
  first `onPlay`, after-reply on quiet, caller-speaks when the caller sends.
  Blue ♪ markers in the conversation (`MediaMarker.tsx`).
- Stereo through the computer for now; four-speaker spatialisation is a
  future idea (would be a "Speakers" setting on the connection).

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

## 7. NEXT TASK (agreed with the user, not started)

The user's requirement: **"the app needs to read the user's intent, and if
it's not clear, give the user options to pick."** Students will write
actions in any wording and **other languages**. Tested: the regex misreads
"during the scene", "for the whole conversation", "Loop the corridor
ambience", "Play background music", "at the start…", "when the call
begins", "at the end" (all came out "once").

Plan:
1. **AI reading of each row-8 line** — new route (e.g. `/api/media/intent`)
   using the quick model (claude-haiku-4-5, as the app's analysis calls do;
   see `src/lib/agent/runtime.ts` / `/api/agent/memory-filter` for the key
   pattern — student key from the app, server key only when local). Output
   per line (zod): kind (`once` | `every` | `throughout` | **`start`** |
   **`end`**), for every: when + voice, `clear: boolean`, and `options` (the
   likely kinds) when unclear. Cache by exact text (IndexedDB), re-read only
   when the wording changes. Regex stays as the offline fallback (widen it:
   during, for the whole…, loop, background, at the start/beginning, when the
   call begins/starts, at the end).
2. **Unclear → options**: the connection box shows "Not sure when this should
   play — pick one:" with the suggested choices as buttons; a **kind**
   dropdown always lets students correct it (stored in `link.timing.kind`,
   which `timingOf` should then honour along with the AI reading).
3. **Playback for the new kinds** (the user asked why the hospital-corridor
   soundscape "throughout scene" didn't play — it isn't implemented yet):
   - throughout: start with the call (Agent speaks first / first message),
     **loop**, **dip under the voice** like the scene music, stop on call end,
     Refresh this scene / Complete restart, or scene switch; ♪ marker; ■ stops.
   - start: play once when the call begins; end: once when it ends
     (`session.ended`).
   - once (moments) and images/video to TouchDesigner are still to come
     (TouchDesigner message format is sketched in `media.ts` `MediaMessage`).

## 8. Other open items

- The user hasn't yet re-deployed the Apps Script (§4).
- Media inspector replacing the TouchDesigner window (discussed, not built).
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
| `src/lib/agent/mediaPlayback.ts` | Playing/stopping sounds, event sounds |
| `src/lib/agent/projectionLayout.ts` | The 11 projection outlines |
| `src/lib/ffmpeg.ts` | Finding/running ffmpeg |
| `src/app/api/sheets/media/route.ts` | Read/write the Media tab via Apps Script |
| `src/app/api/media/thumbnail/route.ts`, `src/app/api/media/ffmpeg/route.ts` | ffmpeg thumbnails; status + npm install |
| `src/components/agent/speechQueue.ts` | `beforeFirst` hook (voice waits for a sound) |
| `src/app/agent/page.tsx` | Media panel wiring, chat folding, sound events in `sendTurn`, `sayAndWait` |

Storage: IndexedDB `goal-agent-studio` v4 store `media` (keys `folder`,
`library`, `links`, `thumb:<id>`); localStorage `process-open:<title>`,
`media-workspace-split`, `media-chat-width`, `media-chat-hidden`,
`media-library-height`.
