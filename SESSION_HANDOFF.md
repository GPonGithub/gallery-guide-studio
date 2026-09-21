# Gallery Guide Studio — Session Handoff

This picks up after the app was built from `REBUILD_SPEC.md` and then extended
in a long follow-up session. Read `REBUILD_SPEC.md` first for the original
architecture and the latency-tuning rationale — it's still accurate for the
chat/voice pipeline. This file covers everything added or changed **after**
that initial build, so a fresh session can continue without re-deriving it.

## Stack (unchanged from spec)

Next.js App Router + TypeScript, Tailwind CSS v4, AI SDK (`ai` package) calling
Anthropic directly, ElevenLabs via a raw `fetch` proxy. All state in browser
`localStorage`. No backend database, no Vercel account.

## How to run it

```bash
npm run dev
```

Or use this session's `run` skill / the Browser pane's `preview_start` with
name `gallery-guide-studio` (config already exists at `.claude/launch.json`).
The dev server's port changes each time it restarts (autoPort) — check the
tool's response for the current URL rather than assuming one.

`.env.local` has empty `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` placeholders
and is **not** the primary way keys get supplied anymore (see below) — it's
just a fallback.

---

## What changed after the initial build, in order

### 1. In-app API keys panel (replaces relying solely on `.env.local`)

- New header button **"API keys"** opens `ApiKeysModal.tsx` — fields for
  Anthropic key, ElevenLabs key, ElevenLabs voice ID.
- These are now part of persisted `StudioState` (`anthropicApiKey`,
  `elevenLabsApiKey`, `voiceId` in `src/lib/types.ts` /
  `src/lib/storage.ts`), so they survive refresh like everything else.
- **"Clear all keys"** wipes both API keys but deliberately keeps the voice
  ID.
- Every server route that needs a key now accepts it from the client
  (request body for chat/detect-labels/generate-playbooks, query param for
  the `GET /api/tts` route since `<audio src>` can't send custom headers)
  and falls back to the `.env.local` value only if the client didn't send
  one. See `src/lib/anthropicModel.ts` for the Anthropic side of this.

### 2. Fixed: auto-detected playbook names not matching the diagram

Root cause: boxes were immediately given fake sequential names
("Playbook 1", "Playbook 2"…) and only *maybe* overwritten later by a vision
call that described button positions in text ("centered at roughly X%, Y%")
— which the model often couldn't use reliably, especially for stacked/nearby
cards.

Fix (`src/lib/detectHotspots.ts`, `src/components/PlaybookCanvas.tsx`):
- Added `annotateWithMarkers()` — draws numbered red circle markers directly
  onto a copy of the uploaded image, one per detected button, positioned
  just above it.
- `/api/detect-labels` now reads that annotated image and is told "marker N
  → read the label at the top of that marker's card," which lets the model
  use real visual/spatial reasoning instead of parsing percentages.
- Boxes are **never** given a name until the label-reading step actually
  returns one. If it fails (bad/missing key, wrong count returned), the user
  gets a clear alert and boxes are named `Untitled box N` — never something
  that looks like a real detected label but isn't.

### 3. Fixed: chat replies silently not appearing

Two distinct bugs, found by building a mock `MockLanguageModelV4` (from
`ai/test`) to reproduce exact Anthropic response shapes without needing a
real API key — this technique is worth reusing if similar chat bugs show up
again.

- **Bug A**: with the spec's required single-step `stopWhen` (Priority
  Directive #1), a tool's `execute` never actually runs, so a
  `tool-changeStage` part never reaches `output-available` — it stops at
  `input-available` forever. The client only checked for `output-available`,
  so any turn where the model called `changeStage` rendered nothing. Fixed
  in `ChatPanel.tsx` by treating `input-available` as the terminal state for
  this tool (it's a pure client-side echo tool anyway, per the spec).
- **Bug B**: if a turn finishes with *no* text and *no* tool call at all
  (`finishReason` something odd, or a too-tight token budget), `useChat`
  never even creates an assistant message entry — `messages` just stays as
  it was. Added a safeguard banner in `ChatPanel.tsx`: if `status === 'ready'`
  and the last message is still the student's own (no reply ever arrived),
  show an amber "agent finished without sending a reply" note instead of
  staying silent. Also bumped `maxOutputTokens` 300 → 1024 in
  `src/app/api/chat/route.ts` (300 was plausibly too tight) and added
  server-side `onFinish` logging of `finishReason`/`usage` for next time.

### 4. Mic behavior fixes (`ChatPanel.tsx`)

- `recognition.continuous` was `false`, so the browser silently stopped
  listening after any pause — changed to `true`; mic now stays on until you
  click it again or hit Send.
- `handleSend` now calls `recognitionRef.current?.stop()` and clears the
  input text.
- **Known Web Speech API race**: clicking the mic again very soon after
  Send/stop can throw `InvalidStateError` because the previous session's
  teardown (`stop()` → `onend`) is async. Fixed with try/catch around
  `recognition.start()` that auto-retries up to 3× with a 250ms backoff
  before giving up and alerting. Confirmed the underlying mechanism is
  correct; could not fully reproduce with real mic audio since this
  environment's browser pane blocks mic access.

### 5. Full visual redesign — "Minimalist Monochrome"

Applied a strict black/white editorial design system across every component.
Key pieces:

- **Fonts** (`src/app/layout.tsx`): Playfair Display (headings), Source
  Serif 4 (body), JetBrains Mono (labels/buttons/chrome) via `next/font`.
- **Tokens** (`src/app/globals.css`): `--color-ink` (#000), `--color-paper`
  (#fff), `--color-muted` (#f5f5f5), `--color-muted-ink` (#525252),
  `--color-hair` (#e5e5e5) exposed as Tailwind utilities (`bg-ink`,
  `text-paper`, etc.) via `@theme inline`. Also a subtle global horizontal-line
  texture overlay and `font-display`/`font-body`/`font-label` utilities.
- **Centralized style primitives** (`src/lib/styles.ts`): `buttonPrimary`,
  `buttonOutline`, `buttonGhost`, `buttonIcon`, `fieldInput`, `fieldLabel` —
  every button/input across all components uses these instead of one-off
  Tailwind strings, so the look lives in one file.
- Zero border-radius, zero shadows, everywhere. Emphasis via **inversion**
  (black-on-white / white-on-black) instead of accent colors — e.g. user chat
  bubbles are solid black, hard errors are an inverted black block, warnings
  are a heavy 4px-bordered box. No red/amber/cyan/fuchsia/slate anywhere
  anymore.
- **Bug found and fixed during this pass**: an unconditional `outline-none`
  on form fields permanently pinned the shared Tailwind CSS variable
  `--tw-outline-style` to `none`, which the `focus-visible:outline-*` utility
  classes read from but never reset — so no focus ring ever actually
  rendered, for any input, anywhere. Removed the unconditional `outline-none`;
  confirmed via `getComputedStyle` and real keyboard Tab navigation that the
  3px black focus ring now works everywhere.
- Also fixed a text-overlap bug in the voice-settings sliders: mono uppercase
  labels ("STABILITY", "SIMILARITY") didn't fit the compact 2-column grid at
  the new font — shortened to "Stab"/"Sim"/etc. and loosened tracking.

### 6. Voice settings panel + presets + test button

- `VoiceSettingsPanel.tsx` — 4 sliders (Stability, Similarity, Style, Speed)
  + a Speaker Boost checkbox, matching ElevenLabs' actual `voice_settings`
  API fields exactly (`stability`, `similarity_boost`, `style`, `speed`,
  `use_speaker_boost` — confirmed via their docs; ranges are 0–1 for the
  first three, 0.7–1.2 for speed — narrowed from the API's full 0.25–4.0
  range since that's ElevenLabs' own recommendation for conversational
  agents rather than one-off narration).
- **"Test voice" button** next to the panel — plays "Hi there, this is what
  I sound like right now. Pretty good, right?" through `/api/tts` using the
  current slider values, so you can adjust-then-test in a loop.
- **Four preset slots** (`VoicePresetButtons.tsx`) to the right of Test
  Voice — click an empty slot to save current settings into it, click a
  filled slot to load it back onto the sliders, **hold** a filled slot
  (~550ms) to overwrite it with current settings. Stored in
  `StudioState.voicePresets` (array of 4, nullable), persisted like
  everything else.
- `/api/tts/route.ts` now builds the ElevenLabs `voice_settings` object from
  query params sent by the client.

### 7. Layout: chat panel narrowed

`src/app/page.tsx`'s grid went from `grid-cols-[1.4fr_1fr]` to
`grid-cols-[17fr_7fr]` — this exact ratio makes the chat column's rendered
width precisely 70% of what it was (30% narrower), with all freed space
going to the canvas column. (Verified by measuring actual rendered widths,
not just eyeballing the ratio.)

### 8. Flow-diagram canvas: pan/zoom infinite canvas

`PlaybookCanvas.tsx` was restructured into a Figma-like infinite canvas:

- Fixed-height (`h-[560px]`) `overflow-hidden` viewport. The image renders
  at its natural pixel size in an absolutely-positioned layer with
  `transform: translate(x,y) scale(scale)`, `transform-origin: 0 0`.
- **Scroll / trackpad swipe** → pan. **Ctrl/Cmd+scroll or pinch** → zoom
  toward the cursor position (pinch is reported as `wheel` + `ctrlKey` by
  browsers). Implemented via a native (non-passive) `wheel` listener in a
  `useEffect`, not React's `onWheel`, because passive-listener ambiguity
  makes `preventDefault()` unreliable there.
- **Click-drag on empty canvas** → pan. Hotspot elements are marked with a
  `data-hotspot` attribute so the pan handler's
  `target.closest('[data-hotspot]')` check excludes them — dragging a
  hotspot's own move/resize handles still works exactly as before and never
  triggers canvas panning.
- **+ / − zoom buttons** and a live percentage readout in the toolbar.
- **"Reset view" button** — computes a contain-fit scale
  (`min(viewportW/naturalW, viewportH/naturalH)`) and centers the image;
  also runs automatically whenever a new image loads.
- Existing hotspot drag/resize math (`startDrag` in the same file) needed
  **zero changes** — it already computed deltas as
  `(screen-space pointer delta) / (element's current getBoundingClientRect()
  size)`, which is scale-invariant by construction. Verified this explicitly
  by dragging a hotspot at a non-100% zoom level and confirming only the
  hotspot moved (image position on screen unchanged), and separately that
  background-drag only pans (box position in storage unchanged).

---

## Current file map

```
src/
  app/
    layout.tsx              — fonts (Playfair/Source Serif/JetBrains Mono)
    globals.css              — design tokens, texture, base styles
    page.tsx                 — header, grid layout, all modals wired up
    api/
      chat/route.ts           — streamText + changeStage tool
      detect-labels/route.ts  — marker-based vision label reading
      generate-playbooks/route.ts
      tts/route.ts             — GET, streams ElevenLabs, voice_settings from query
  components/
    PlaybookCanvas.tsx        — pan/zoom canvas, hotspot CRUD, auto-detect
    ChatPanel.tsx             — useChat, mic, TTS playback, voice settings row
    VoiceSettingsPanel.tsx    — 4 sliders + speaker boost checkbox
    VoicePresetButtons.tsx    — 4 save/load/overwrite slots
    PlaybookEditorModal.tsx   — per-box instructions, autosave
    MasterPlaybookModal.tsx   — global context, autosave
    ApiKeysModal.tsx          — key entry + clear
  lib/
    types.ts                  — StudioState, PlaybookBox, VoiceSettings
    storage.ts                 — localStorage load/save, defaults
    styles.ts                  — buttonPrimary/Outline/Ghost/Icon, fieldInput, panel
    detectHotspots.ts          — blue-button CV detection + marker annotation
    anthropicModel.ts          — client-key-or-env-fallback provider builder
```

## Known limitations (carried over from REBUILD_SPEC.md, still true)

- No knowledge-base/PDF upload, no TouchDesigner/OSC authoring, no
  multi-user — all out of scope per the original vision, not implemented.
- No Figma live-import (org Figma seat licensing issue) — PNG export +
  auto-detect is the workflow.
- No truncation-detection heuristic (was built, then removed upstream of
  this session) — worth revisiting if truncated replies show up.

## Things to verify with a real API key (this session's browser sandbox blocks mic + can't hold real keys)

- Real end-to-end voice test with a live ElevenLabs key (only tested via
  mocks and "no key configured" error paths here).
- Real microphone continuous-listening behavior and the restart-race fix
  under actual audio input (mic access is blocked in this session's browser
  pane, so only the code path and error handling were verified, not real
  speech capture).
- Auto-detect label reading accuracy on the user's actual uploaded diagrams
  with a working Anthropic key (verified the mechanism and prompt design
  thoroughly with synthetic test images and mocks, but not the user's real
  files with a real key in this session).

## Session state notes

- Dev server URL changes on every restart — don't assume a prior URL still
  works; check the current preview/run result.
- Browser localStorage key: `gallery-guide-studio:v1`. Test sessions in this
  environment repeatedly wrote and cleared this key with synthetic data —
  the user's own browser (wherever they've actually been testing) holds
  their real state, separate from this session's sandboxed browser pane.
