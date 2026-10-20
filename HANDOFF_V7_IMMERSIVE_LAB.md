# v7 handoff — Immersive Lab development (Chatbot Designer)

Written 2026-10-19 to continue in a new conversation. **Read this file first.** For the detail of each
feature, read `HANDOFF_V6_IMMERSIVE_MEDIA.md` (§7a–7t — the v7 work is written up in §7t), then
`HANDOFF_V5_CHATBOT_DESIGNER.md` for older history. The shared show-file format is in `SHOW_FORMAT.md`.

---

## 0. Where things stand

- **Branch `v7`** is the working branch (pushed to GitHub, `GPonGithub/gallery-guide-studio`).
  Latest commit **`c3a5bfa`**. v7 was made from v6 `baa00af`.
- **Branch `v6`** is still what the **live site** deploys: https://gallery-guide-studio.vercel.app/agent.
  Pushing v7 only makes a Vercel *preview*. To go live: merge v7 into v6 (or point Vercel's production
  branch at v7) — only when the user asks.
- **Not committed yet** (in the working tree on v7):
  - **Export Project / Import Project** buttons — `src/components/agent/ProjectFileButtons.tsx`,
    `src/lib/projectBackup.ts`, a small change in `src/app/agent/page.tsx` (header), and the handoff note.
    Round trip tested in the browser pane. Ask the user before committing.
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

> Continue developing the Immersive Lab Chatbot Designer on branch **v7** in this project. First read
> `HANDOFF_V7_IMMERSIVE_LAB.md` in the project root in full, then `HANDOFF_V6_IMMERSIVE_MEDIA.md` §7t.
> Tell me briefly where things stand (including what's uncommitted) and ask what I'd like to work on next.
> Don't change anything until I ask.
