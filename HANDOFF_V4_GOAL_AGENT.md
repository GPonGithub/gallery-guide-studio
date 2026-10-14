# v4 handoff — Goal Agent Studio

**Read this first next session.** Branch `v4-goal-agent`. This session replaced the
rigid step-table conversation engine with a **goal-driven agent**, and built a full
loop around it: brief → AI-designed flow → FigJam board → edit → import → talk to it
by voice. The original v3 app is untouched and still runs at `/`.

- **New app:** http://localhost:3000/agent
- **Old v3 app:** http://localhost:3000 (step tables, phone testing, FigJam step plugin)
- **FigJam template board:** https://www.figma.com/board/Wb6KBzkENf3gBzf45RgVjb
  ("Goal Agent Template", in *Grahams MASTER Team* — the only team with a full seat)

---

## 1. The idea (why v4 exists)

v3 made every conversation follow a step table line by line, so anything unexpected
broke it. v4 splits the work:

| Layer | Who runs it | What it does |
|---|---|---|
| **Inside a stage** | The LLM | Talks freely toward the stage's **goal**, answers side questions, steers back |
| **Between stages** | Plain code | Tracks the stage, collected information, allowed exits and TouchDesigner cues |

The LLM only ever *proposes* changes ("this fills `patient_name`", "move to 3A");
`runtime.ts` checks each proposal against what the student defined before applying it.
Invented information names, nonexistent exits and premature "goal met" are rejected
and shown in the inspector.

**Rule (user-set): conversations start at the lowest stage code** (1 before 2A
before 2B…), never detection/array order. See `startStage()` in `flow.ts`.

---

## 2. How a turn works

```
caller speaks ──► open mic waits for real speech, then a pause (slider)
                  └─ as soon as Chrome confirms a phrase, the turn STARTS EARLY
                     (thrown away if the caller keeps talking)

/api/agent/turn (streams NDJSON):
   ANALYSE (Haiku, structured)  ║  RESPOND (Sonnet 5, streamed)   ← run in parallel
   apply(): code checks proposals, moves stage, fires/holds cues
   if the situation changed (new stage / goal met / ended / off-topic escalation)
        → discard the early reply unspoken, stream a new one
   else → release the early reply's sentences
   emits {type:'sentence'} per sentence, then {type:'done', reply, state, events, timings}

app: each sentence → chat bubble + SpeechQueue → /api/tts/stream (ticket) → <audio>
     sentences' audio is requested immediately and played strictly in order
after: /api/agent/moments (moment cues, judged against the reply) and
       /api/agent/cues (cues held by an early turn) — never block the reply
```

Key files:

| File | What it does |
|---|---|
| `src/lib/agent/types.ts` | Data model: `AgentFlow`, `Stage`, `Slot`, `Exit`, `Cue`, `SessionState`, events |
| `src/lib/agent/runtime.ts` | The engine: `analyse`, `Turn` (apply/cues), `responderSystem`, `runTurnStream`, `runMoments`, `sendHeldCues` |
| `src/lib/agent/sentences.ts` | Streaming sentence splitter (handles Dr./p.m./$3.50, merges tiny fragments) |
| `src/lib/agent/flow.ts` | Sample UCSF flow, `sortStages`, `startStage`, `initialState` |
| `src/lib/agent/validate.ts` | Flow checker: dead ends, unreachable stages, missing exits, >1 automatic exit |
| `src/lib/agent/generate.ts` | Brief → flow with Claude (design rules in `SYSTEM`), one self-repair pass |
| `src/lib/agent/cards.ts` | FigJam card format: `flowToBoard` / `boardToFlow` (the only definition of it) |
| `src/lib/agent/projectStore.ts` | Saved projects in `.data/agent-projects.json` |
| `src/app/agent/page.tsx` | The page: editor tabs, chat, inspector, voice, open mic, projects |
| `src/components/agent/*` | `DesignPanel`, `FlowEditor`, `Inspector`, `OpenMic`, `ProjectsMenu`, `VoicePanel`, `speechQueue` |
| `src/lib/elevenlabs.ts` | Shared ElevenLabs call (normal Flash / expressive v4 Turbo→v3) |
| `src/lib/ttsTickets.ts` | One-time tickets so audio streams via `<audio src>` without the key in a URL |

API routes (all under `src/app/api/`): `agent/turn` (streamed), `agent/generate`,
`agent/moments`, `agent/cues`, `agent/projects`, `tts/stream`, `tts/check`, `tts/voices`,
plus the existing `figma-jobs` queue (extended).

---

## 3. Features shipped this session (all on `/agent`)

**Authoring**
- Stage cards typed in the left panel: goal, information to collect (required/optional),
  instructions, steering (strict/balanced/relaxed), exits (automatic "when goal met" or
  conditional), TouchDesigner cues (enter / goal met / exit / information collected /
  plain-English moment). Master card: persona, rules, any-stage exits, global cues, TD address.
- **Design tab:** write a brief → **Generate flow** (Claude designs the stages, ~45s) →
  optionally auto-drawn on FigJam → edit the board → **Import from FigJam**.
- **FigJam via the existing plugin** (`figjam-plugin/`), extended with two job kinds:
  `draw-agent-flow` (draws cards + arrows; replaces its own previous drawing, tagged with
  pluginData) and `read-agent-flow` (reads every table back). Figma's REST API can't draw,
  so the plugin must be **open in the board, in the Figma desktop app**, "Listen for
  requests" ticked. A green/red **plugin status light** shows whether it's polling.
- Card syntax (GUIDE card on the board explains it): `name* — description`,
  `→ CODE when <condition>`, `→ CODE when goal met`, `CUE on enter|goal met|exit|<slot>`,
  `CUE when <moment>`. FigJam is the source of truth on import (replaces the flow).
- **Projects:** save/open/copy/delete named projects (flow + brief + board link), with a
  FigJam ↗ link per project. Stored server-side in `.data/agent-projects.json`
  (gitignored, blocked over the public tunnel). API keys are never part of a project.

**Talking to it**
- Chat + inspector (slides out from the right; tucked in by default; tab shows stage code).
- **Open mic (blue 🎙️)** next to push-to-talk 🎤: stays on across turns, deaf while the
  agent thinks/speaks, auto-restarts, dedupes, won't start the countdown until real speech
  (a final phrase or 3+ words), +2s grace while Chrome thinks you're mid-phrase.
  **Pause before sending** slider (0.2–3s, default 1.0).
- **Voice panel:** up to 5 named voices (pick from your ElevenLabs account by name, or
  paste an ID), per-voice Test / Test expressive, which one is in use; shared sliders
  (stability, similarity, style, speed, speaker boost); **Check the sliders work** (renders
  6 seeded clips and compares).
- **Expressive mode:** "✦ Agent speaks expressively first" → the agent writes cues
  (`[warmly]`, `[laughs softly]`…, max two per reply), spoken by ElevenLabs
  **`eleven_v4_turbo`** (falls back to `eleven_v3`). Cues hidden in bubbles. v4 only takes
  stability + similarity; speed is applied in the browser (`playbackRate`).
- Settings apply from the very next sentence (read at speaking time); speed changes live.

**Latency work (in order of impact)**
1. Analyse ∥ respond in parallel; respond again only if the situation changed.
2. Voice streams as it arrives (ticket → `<audio src>`), not download-then-play.
3. Turn starts during the open-mic pause (cues held until the turn is used; aborted
   turns stop their model calls via `req.signal`).
4. **Reply streams sentence by sentence;** first sentence speaks as soon as the analysis
   confirms it — while the rest is still being written. Normal voice gets the previous
   sentence as `previous_text` for continuity (retries without it if ElevenLabs objects).
5. Moment cues checked after the reply, off the critical path.
6. *(after c5374a8)* Voice head start: the early reply's first sentence is sent as a
   `draft` event and its audio starts being made while the analysis runs (played only if
   confirmed). Model "thinking" explicitly disabled on every turn call. The fixed part of
   the reply prompt (persona, rules, knowledge base) is marked for Anthropic prompt caching.

Last measured (before items 2–4): agent turn 1.4–3.4s, full-clip voice 0.9–1.7s.
**Not yet measured with real keys after items 2–4** — the inspector shows
`first sentence ready X.Xs` per turn; check it first thing.

---

### Added in the second session (commit after c5374a8)

- **Knowledge base** (Design tab, yellow field): student-written facts the agent may use and
  must not go beyond. In both the analysis and reply prompts. Round-trips as a KNOWLEDGE card
  on the FigJam board (top row: MASTER, GUIDE, KNOWLEDGE). Kept on generate; on import, the
  board's card wins, and without one the app's copy is kept.
- **Voice reliability:** `ttsTickets.ts` reads ElevenLabs audio into memory immediately (an
  idle upstream stream was being cut off mid-sentence). If a streamed sentence still fails,
  `speechQueue.ts` fetches the whole clip from `/api/tts` and plays that.
- **Per-voice settings:** each voice has "Save settings"; choosing a voice moves the sliders
  to its saved settings. Voice cards fold (click the name line).
- **Background music** (`♫ Music` panel): drop an MP3, volume 0–10 (squared), dip 0–10
  (share of volume kept while the agent talks: 1 − dip/10), "Try the dip". Starts on
  "Agent speaks first" (either one), ease-curve fades via a Web Audio gain node
  (`backgroundMusic.ts`), fades out at call end / Restart. The open mic can hear the music
  on speakers — not yet handled.
- **No stage directions:** `spokenText.ts` filters the reply stream. It removes \*actions\*
  and (laughs), keeps short \*emphasis\* as plain words, and drops [cues] unless the
  expressive voice is on. The prompt also forbids them.
- **Projects save voices and music.** Header button: grey with red "Not saved" when the
  flow/brief/knowledge/board/voices/music differ from the last save; it opens Projects. The
  music file is stored at `.data/agent-music/<projectId>` (`/api/agent/projects/music`). The
  browser's working copy is in IndexedDB (`musicStore.ts`), keyed so it matches the project.

## 4. Verified vs. not verified

**Verified** (stand-in AI/voice/mic, real code): engine proposal checking; card format
round-trip incl. a real read of the template board; flow checker; plugin's app-side job
flow; drawing layout on a real board (edge-magnet arrows — relative positions were tried
and are broken on tables); projects round trip; open mic (countdown/grace/restart/pause);
streaming order/gating; speech queue order + mic staying deaf between sentences; voice
routes' error paths; sentence splitter.

**Not verified with real keys yet:** streamed voice end-to-end, `previous_text` on Flash,
v4 Turbo availability on the account, real latency after this session's changes, the
plugin's actual drawing after the arrow-layout change (user confirmed drawing works
before it). The user *did* run: flow generation (worked, 46s), FigJam drawing (worked),
expressive voice (worked), the slider check (stability + speed clearly work; similarity
and style showed no measurable length change on Flash).

---

## 5. Environment notes (things that bit us)

- **Mac is macOS 27 / Xcode 27**; iPhone 17 on iOS 26.6.2.
- **iCloud "Optimize Storage" offloads project files** (Documents is iCloud-synced). It
  stalled `next dev` with no error. Fixed by reinstalling `node_modules` and marking it
  excluded (`xattr com.apple.fileprovider.ignore#P`), and `.next` → `.next.nosync`
  symlink. **`ios/App/Pods` still has ~20 offloaded files** — the next iOS build may hang
  the same way. Long-term fix: move the project out of `Documents` (e.g. `~/Developer`).
- **CocoaPods is broken** (it was an Intel/Rosetta Ruby; Rosetta is gone on macOS 27).
  Device builds still work because Pods were already installed. Needed again only if
  native plugins change. `patches/` holds the speech-plugin crash fix (applied by
  `postinstall` via patch-package).
- **Cloudflare quick tunnel URL changes every restart.** For the iPhone app, update
  `DEV_TUNNEL_URL` in `capacitor.config.ts`, `npx cap copy ios`, rebuild.
- **Keys:** Anthropic + ElevenLabs keys live in the browser (localStorage
  `gallery-guide-agent:v1`, borrowed on first visit from the v3 studio's storage).
  ElevenLabs keys never go in URLs in v4 (the old v3 GET `/api/tts` still does).

---

## 6. Open items / next steps (suggested order)

1. **Real-key smoke test** of streaming voice + first-sentence timing; read the inspector timings.
2. **iPhone app for v4** — the native shell still points at the v3 `/phone` page. Decide
   whether `/agent` (or a talk-only v4 page) replaces it; port OpenMic to the native
   speech plugin path.
3. **TouchDesigner:** user still owes two decisions from the PDF (BOT-step timing; whether
   USER steps fire). Classroom topology decides HTTP vs. MQTT (MQTT recommended for
   shared screens).
4. Per-project voice (and/or per-voice settings) — offered, not built.
5. Optional speed: faster reply model toggle; analysis is now the floor.
6. Simulated-caller tester + transcript export (from the original v4 spec).
7. Commit hygiene: decide whether v3 code paths get retired once v4 covers phone testing.

---

## 7. Deliverables made this session (repo root)

- `TouchDesigner Connection Guide.pdf` — HTTP/Web Server DAT setup (decisions pending).
- `Expressive Voice Prompt - Chatbot Projects.pdf` — student prompt; also published as a
  private shareable page: https://claude.ai/artifact/3mVXKzemzMgaLBhdGXrAHy (share it from
  the page's Share menu).
- `Gallery Guide Studio - Project Summary.pdf` — architecture summary for a collaborator (earlier).

## 8. Running it

```bash
npm run dev
```
Then open http://localhost:3000/agent. If `next dev` hangs with no output, suspect iCloud
offloading (section 5) before anything else.
