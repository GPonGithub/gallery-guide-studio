# v5 handoff — Chatbot Designer (hosted)

**Read this first next session.** Branch `v5-hosted` (pushed; it is also Vercel's
production branch). The v4 "Goal Agent Studio" is now **Chatbot Designer**: scenes
come from a Google Sheet, a patient's information carries from scene to scene and is
written back into the sheet, there's a guided onboarding tour, and the app is live
on Vercel for students.

| | |
|---|---|
| **Live (students)** | https://gallery-guide-studio.vercel.app → redirects to `/agent` |
| **Local** | http://localhost:3000/agent (`npm run dev`; `/` is still the old v3 studio) |
| **GitHub** | `GPonGithub/gallery-guide-studio`, branch `v5-hosted` |
| **Vercel project** | `gpongithubs-projects/gallery-guide-studio` (Hobby plan) |
| **Safe fallback** | tag `v4-local-stable` (the local-only v4, before hosting work) |
| **Last commit** | `9f21857` Hosting on Vercel, Onboard Me tour |

Every push to `v5-hosted` now deploys to production automatically.

---

## 1. What the app is

Students design a voice chatbot (e.g. "Maya, the patient advocate") as a series of
**scenes** — Scene 1 Outreach Call, Scene 2 Reminder Call, Scene 3 Check-in… Each
scene is a goal-driven conversation (stages with goals, as in v4), generated from a
plain-English description. They talk to it by text or voice (ElevenLabs), with
optional background music and TouchDesigner cues, and see it as a FigJam flowchart.

What's new in v5: the scenes, their information rules and the patient's memory all
connect — what the patient says in Scene 1 is remembered, used in Scene 2, and saved
to the spreadsheet.

---

## 2. The interface

### Header
**Onboard Me** · Chatbot Designer (scene name · saved state · FigJam link) ·
**Scenes** · **Saved / Not Saved** (red/green) · **Keys**

### Design Process column (left; drag its right border to resize, 300–900px, remembered)
Seven collapsible sections, all closed by default:

1. **Generate scenes from Google Sheet** — sheet URL, **Generate Scenes** (black
   spinner while running), "keep mine / use the sheet" conflicts, and the
   **Save to the sheet (row 7)** panel (Apps Script link, Test the connection,
   one-time setup steps with **Copy the script**).
2. **Describe the conversation** — scene number buttons, scene heading, stage chips
   (Master · 1 · 2A … · + Stage, editor opens inline), the yellow description box,
   "Draw it on my FigJam board afterwards", **Generate New Conversation** (red) /
   **Conversation Generated** (green), and **Update This Scene**.
3. **Information this scene can use** — the knowledge base (sheet row 4, "All
   scenes" text first) + "Also usable: the patient's earlier scenes" list. A scene
   with leftover old "can use" text shows an orange note with "Move it into the box
   above".
4. **Information saved from the scene** — what to collect (row 5) + **List of
   Saved Information from This Scene · N** (selected patient, "Label: value" lines,
   scrollable) + sheet-sync status ("✓ Saved to row 7, column C at 10:32").
5. **Information this scene cannot use** — restrictions (row 6) + "Kept out of
   this scene" list.
6. **FigJam board** — **Choose Board** (None / Your own board / saved boards) →
   **Select This Board** → green **Board Selected**; "In use: …" line; Board List
   Editor (for use by instructor only — 100px below, collapsed, local only); View in
   FigJam / Write to FigJam; plugin status dot; setup steps (local or hosted
   version, hosted shows the connection code and plugin download).
7. **Bring your edits back** — Import from FigJam. (Not in the onboarding yet, by
   request.)

### Chat (middle)
- Toolbar row 1: **Complete restart** (heavier outline, confirm dialog) · **Refresh
  this scene** · **Start at** (thin black outline) · ✦ Expressive voice · **Patient**
- Toolbar row 2: **♫ Music** · **Voice**
- Dialogue area: very light grey (#f5f5f5); chatbot replies white boxes with black
  outline; caller's messages dark grey (#525252) with white text.
- TouchDesigner cue window, then the input row (open mic, push-to-talk, text).
- Conversations are kept **per scene and per Start-at point**; switching scenes or
  start points never loses one. Only Refresh / Complete restart clear them.

### Inspector (right, collapsible) — per-turn analysis, events, timings.

---

## 3. Google Sheet layout

Column A = row labels. Column **B = "All scenes"** (row 1 must say "All scenes"):
its rows 3–6 are added to *every* scene, ahead of the scene's own text. Scenes are
columns **C onward** (up to 20, through Z).

| Row | Content | Read by the app? |
|---|---|---|
| 1 | Scene number ("SCENE 1", "4", "12B") — or "All scenes" | yes |
| 2 | Scene name | yes |
| 3 | Describe the conversation | yes → yellow box |
| 4 | Knowledge base (information that can be used) | yes → section 3 |
| 5 | Information saved from this scene | yes → section 4 |
| 6 | Information this scene cannot use | yes → section 5 |
| 7 | List of saved information from this scene | **written** by the app (via Apps Script), never read |

- Shared by link: **Anyone with the link → Viewer** is all that's needed to read it.
- Re-importing: scenes are matched by **scene number** first (so inserting a column
  like "All scenes" doesn't shuffle them), else by column. Unedited scenes update;
  scenes edited in the app ask "Keep mine / Use the sheet". Archived scenes are never
  touched.
- **Update This Scene** re-reads just the open scene's column (asks first if it was
  edited here), then regenerates, clears the chat, and redraws in FigJam.
- Parser: `src/lib/agent/sheetScenes.ts` (`mapSheetScenes`); import/merge logic:
  `src/lib/agent/localProjects.ts` (`importSheetScenes`, `applySheetScene`).

---

## 4. Patients and cross-scene memory

- **Patient** menu (chat toolbar): select / add / clear memory / delete. A patient is
  made automatically the first time something is saved.
- After each caller turn, the analysis step (Haiku) emits `SAVE Label = value` lines
  for anything section 4 asks to collect: **Title Case labels** ("Preferred Doctor",
  "Appointment Date", "Text Reminder Requested"), full dates ("October 22, 2026"),
  times ("10:30 a.m."), Yes/No. Only what the caller actually said or confirmed.
- **Corrections replace**: the analysis now sees what's already saved *with values*
  ("Phone Number = 415 555 0000") and recorded slots from other stages, and is told
  to SET/SAVE again with the corrected value. (Fixed tonight after a wrong phone
  number stuck.)
- **Later scenes** (higher numbers only) get the patient's earlier saves. If several
  earlier scenes saved the same label, only the latest scene's value is passed on.
- **Priority:** the bot is told saved information (and anything said in this call)
  is newer than the knowledge base and wins where they differ.
- **Cannot use** filter: before the bot sees earlier memory, items matching section 5
  are removed (label match + a Haiku classifier, fails closed). Shown as "Kept out".
- Stored in the browser: IndexedDB `goal-agent-studio`, store `patients`.
- Code: `src/lib/agent/memory.ts`, `src/lib/agent/runtime.ts` (`analyse`,
  `responderSystem`, `blockedMemory`), `/api/agent/memory-filter`.

---

## 5. Saving to the sheet (row 7)

A link-shared sheet is read-only, so writes go through a **Google Apps Script**
pasted into the sheet (Extensions → Apps Script) and deployed as a web app
(Execute as: Me, Who has access: Anyone). The app's section 1 has the steps and a
**Copy the script** button.

- The script (`src/lib/agent/sheetScript.ts`, `SHEET_SCRIPT`) has `@OnlyCurrentDoc`
  — Google only asks for access to **that one spreadsheet**.
- It refuses unless **A7** contains "saved information", never writes to the "All
  scenes" column, never writes rows 1–6, and uses a document lock.
- Cell format: `Patient: Susie` then one `Label: value` line each. Updates lines by
  label, keeps unrelated lines; a **different patient replaces the cell** (patients
  are never mixed).
- The app writes ~0.8s after a save (batched), and when you switch patient.
- Server proxy: `/api/sheets/saved` (only to `script.google.com/macros/s/…/exec`).
- Status shown in section 4. One-way: hand edits to row 7 are not read back.
- Google's "hasn't verified this app" warning is expected (it's your own script):
  Advanced → Go to … → Allow.
- **Not yet tested against the real sheet end-to-end** — the user had started the
  Apps Script authorization; check row 7 fills after a conversation.

---

## 6. FigJam

### Board list (instructor)
- `src/data/figjamBoards.json` — part of the repo, so every copy and the hosted site
  get it. Edited in section 6's Board List Editor (local only; refused when hosted or
  through the tunnel), then commit + push. Currently: Team ED Figjam Board 1, Team ER
  Figjam Board 1.

### Plugin and job queue
- App queues jobs (`draw-agent-flow`, `read-agent-flow`); the plugin panel polls for
  them every ~4s. `src/lib/figmaJobStore.ts`, `/api/figma-jobs`.
- **Local:** in-memory, one shared queue; plugin imported from
  `figjam-plugin/manifest.json`, App address `http://localhost:3000`, code empty.
- **Hosted:** jobs in **Upstash Redis** (`upstash-kv-coffee-grass`, free plan,
  iad1; env vars `KV_REST_API_URL` / `KV_REST_API_TOKEN`), separated by a
  **connection code** per browser (e.g. `K7QM-2XRB`, shown in section 6). Plugin is
  downloaded from `/api/figjam-plugin` — a zip built on request with the site's
  address in the manifest's allowed domains and as the default App address; own
  id/name "Chatbot Designer — FigJam" so it never shares settings with a local copy.
- Plugin panel now has **App address** and **Connection code** fields
  (`figjam-plugin/ui.html`, saved via `figma.clientStorage` in `code.js`).
- `figma.fileKey` is never available to development plugins — that's why codes,
  not boards, separate students.
- Each scene is drawn in its own FigJam section, placed in number order without
  overlap; fingerprint tracks whether the board is current.
- **Untested:** importing the downloaded plugin into Figma desktop and drawing from
  the hosted site. The live queue itself was tested end to end with a fake code.

---

## 7. Onboard Me (guided tour)

- 22 steps: welcome · keys · voice (choose, Voice ID, test, sliders, save, pause) ·
  music · sheet URL · Apps Script setup · Generate Scenes · Pick a Scene · stages ·
  generate conversation · can use · what to save · saved list · cannot use · choose
  board · draw flowchart · finish. (Section 7 deliberately left out.)
- Engine `src/components/agent/OnboardingTour.tsx`; wording
  `src/components/agent/onboardingSteps.tsx` (edit text there).
- Points at `data-tour="…"` markers on real controls; opens panels itself (and closes
  only what it opened); dims the page with a blue outline + arrow; card never covers
  the control; follows resizing/scrolling; Escape/× close; progress saved
  (`chatbot-designer-onboarding`) with "Pick up where I left off / Start again".
- Never presses action buttons. A step whose control isn't there yet can point at a
  `fallback` (e.g. Pick a Scene → Generate Scenes) and switches when it appears.
- Voice / Music / Patient panels ignore clicks inside `[data-tour-ui]` so the tour's
  Next doesn't close them.

---

## 8. Hosting (Vercel) — see `HOSTING.md`

- `isHosted = Boolean(process.env.VERCEL)` (`src/lib/serverKeys.ts`); the page asks
  `/api/hosting` → `{ hosted, figjamReady }` (`src/lib/agent/hosting.ts`).
- Hosted copy: **never uses server keys** (students type their own, kept in their
  browser); **never sends TouchDesigner cues** from the server (closes an open-proxy
  hole; the cue window says so); `/` redirects to `/agent`; board list read-only;
  projects routes off.
- Students' scenes, patients, music live in **their browser** (IndexedDB) — tell
  them to export scenes; clearing browser data loses them.
- Students should use **Chrome/Edge** (speech recognition) and **made-up patients**.
- Vercel setup done tonight (via the user's Chrome): production branch → `v5-hosted`,
  deployed `9f21857`, Upstash created + connected (prefix `KV`), redeployed. Live
  checks: `hosted:true, figjamReady:true`, code separation works, plugin zip correct.

---

## 9. Other changes this session (summary)

- Renamed Goal Agent Studio → **Chatbot Designer** (heading, tab title, import error,
  board text). FigJam plugin's own local name unchanged ("Gallery Guide Studio —
  Playbook Builder").
- Design Process reorders (final order above); "can use" merged into the knowledge
  base; Bring your edits back split out as section 7.
- Section 1 explanatory text removed.
- Resizable Design column; light-grey dialogue area; dark-grey caller bubbles;
  Start-at outline restored.
- Scenes dialog (from earlier): numbered, drag reorder, archive, delete confirm,
  draft row for New Blank Scene.

---

## 10. Storage reference

| Where | Key / store | What |
|---|---|---|
| localStorage | `gallery-guide-agent:v1` | app state (flow, keys, brief, sheet URLs, `sheetScriptUrl`, board, voices…) |
| localStorage | `goal-agent-conversations:v2` | conversations per `scene::start` |
| localStorage | `goal-agent-design-width` | Design column width |
| localStorage | `figjam-connection-code` | this browser's FigJam code |
| localStorage | `chatbot-designer-onboarding` | tour progress |
| IndexedDB `goal-agent-studio` | `projects`, `projectMusic`, `music`, `patients` | scenes, music files, patients' memory |
| repo | `src/data/figjamBoards.json` | instructor's board list |
| Upstash (hosted) | `figjam:job:*`, `figjam:queue:*`, `figjam:seen:*` | FigJam jobs (30 min TTL) |

---

## 11. Not yet verified / open items

1. **Real end-to-end tests still needed:** Apps Script row-7 writes on the real
   sheet; the hosted plugin download imported into Figma desktop; a full hosted run
   with a student's own keys.
2. **Phone-number correction fix** — reasoned from code, not reproduced (no key on
   this machine). Re-run the conversation and check Step 4's list.
3. **Saved info vs knowledge base priority** — prompt change only; test Scene 1 →
   Scene 2 with a changed phone number.
4. **TouchDesigner on the hosted site** — cues aren't sent. Options: send from the
   browser (CORS/mixed content issues) or a relay (MQTT). Was "hosting step 5".
5. **Row 7 is one-way** — sheet edits to row 7 aren't read back. Could be added.
6. Old v3 routes (`/phone`, `/api/sync-figma`, `/api/chat`, …) are still deployed;
   harmless (no server keys) but unused — could be removed or blocked when hosted.
7. Onboarding: section 7 not covered (by request). "Draw the flowchart" could use a
   `fallback` to Generate New Conversation like Pick a Scene does.
8. Two personal PNGs in the repo folder are deliberately **never committed**
   ("APPOINTMENT FLOW CHART_05.png", "Screenshot 2026-08-12…PM 2.png").
9. `figma.fileKey` can't be used by dev plugins — if the plugin is ever published
   privately to an org, board-based matching becomes possible.

---

## 12. Key files

| Area | Files |
|---|---|
| Page | `src/app/agent/page.tsx` |
| Design column | `src/components/agent/DesignPanel.tsx`, `CollapsiblePanel.tsx`, `DesignResizeHandle.tsx` |
| Sheet | `src/lib/agent/sheetScenes.ts`, `localProjects.ts`, `sheetScript.ts`, `src/components/agent/SheetSaving.tsx`, `/api/sheets/scenes`, `/api/sheets/saved` |
| Memory | `src/lib/agent/memory.ts`, `src/components/agent/PatientMenu.tsx`, `/api/agent/memory-filter` |
| Runtime | `src/lib/agent/runtime.ts`, `types.ts`, `/api/agent/turn`, `/api/agent/generate` |
| FigJam | `src/components/agent/BoardPicker.tsx`, `src/lib/figjamBoards.ts`, `src/data/figjamBoards.json`, `src/lib/figmaJobStore.ts`, `/api/figma-jobs`, `/api/figjam-plugin`, `src/lib/zip.ts`, `figjam-plugin/` |
| Tour | `src/components/agent/OnboardingTour.tsx`, `onboardingSteps.tsx` |
| Hosting | `HOSTING.md`, `src/lib/serverKeys.ts`, `src/lib/agent/hosting.ts`, `/api/hosting`, `next.config.ts` |
| Voice / music / TD | `VoicePanel.tsx`, `MusicPanel.tsx`, `streamedAudio.ts`, `speechQueue.ts`, `CueMonitor.tsx` |
