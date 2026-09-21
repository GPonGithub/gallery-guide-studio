# Gallery Guide Studio — Session Handoff

This picks up after the app was built from `REBUILD_SPEC.md` and then extended
across two long follow-up sessions. Read `REBUILD_SPEC.md` first for the
original architecture and the latency-tuning rationale — it's still accurate
for the chat/voice pipeline. This file covers everything added or changed
**after** that initial build, in chronological order, so a fresh session can
continue without re-deriving any of it.

## Stack (unchanged from spec)

Next.js App Router + TypeScript, Tailwind CSS v4, AI SDK (`ai` package) calling
Anthropic directly, ElevenLabs via a raw `fetch` proxy. All state in browser
`localStorage`. No backend database.

## Repo / GitHub

Pushed to **https://github.com/GPonGithub/gallery-guide-studio** (public,
`origin/main`). `.env*` is gitignored.

**⚠️ As of this handoff, the working tree has uncommitted changes** covering
everything in sections 9–12 below (git status shows modifications to
`src/app/api/generate-playbooks/route.ts`, `src/app/page.tsx`,
`src/components/ChatPanel.tsx`, `src/components/PlaybookCanvas.tsx`,
`src/components/PlaybookEditorModal.tsx`) — nothing has been committed or
pushed since the initial commit. There are also two **untracked** files at the
repo root, `APPOINTMENT FLOW CHART_02.png` and `APPOINTMENT FLOW CHART_03.png`
— these look like the user's own reference images dropped into the project
directory (not created by any session work); leave them alone unless the user
says otherwise, and don't `git add -A` blindly.

## How to run it

```bash
npm run dev
```

Or use the Browser pane's `preview_start` with name `gallery-guide-studio`
(config already exists at `.claude/launch.json`). The dev server's port
changes every restart (autoPort) — check the tool's response for the current
URL rather than assuming one.

`.env.local` has empty `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` placeholders
and is **not** the primary way keys get supplied anymore (see §1) — it's just
a fallback.

---

## What changed, in order

### 1. In-app API keys panel (replaces relying solely on `.env.local`)

- Header button **"API keys"** opens `ApiKeysModal.tsx` — fields for
  Anthropic key, ElevenLabs key, ElevenLabs voice ID.
- Persisted in `StudioState` (`anthropicApiKey`, `elevenLabsApiKey`,
  `voiceId`), survives refresh.
- **"Clear all keys"** wipes both API keys but deliberately keeps the voice
  ID.
- Every server route accepts the key from the client (body for
  chat/detect-labels/generate-playbooks, query param for the `GET /api/tts`
  route since `<audio src>` can't send headers) and falls back to
  `.env.local` only if the client didn't send one (`src/lib/anthropicModel.ts`).

### 2. Fixed: auto-detected playbook names not matching the diagram

Root cause: boxes got fake sequential names immediately, only *maybe*
overwritten by a vision call describing positions in text, which the model
couldn't reliably map back to labels.

Fix (`src/lib/detectHotspots.ts`, `PlaybookCanvas.tsx`): `annotateWithMarkers()`
draws numbered red circle markers onto a copy of the image; `/api/detect-labels`
is told "marker N → read the label at the top of that marker's card" — real
visual reasoning instead of percentage parsing. Boxes are never named until
the label-reading step actually returns something; failure → clear alert +
`Untitled box N`, never a fake-looking label.

### 3. Fixed: chat replies silently not appearing

Two distinct bugs, found by mocking `MockLanguageModelV4` (from `ai/test`) to
reproduce exact Anthropic response shapes without a real key — reuse this
technique for future chat bugs.

- **Bug A**: with the spec's single-step `stopWhen`, a tool's `execute` never
  runs, so `tool-changeStage` sticks at `input-available` and never reaches
  `output-available`. Client only checked for the latter → silent no-op.
  Fixed in `ChatPanel.tsx` by treating `input-available` as terminal for this
  tool.
- **Bug B**: a turn with no text and no tool call creates no assistant
  message at all. Added an amber "agent finished without sending a reply"
  fallback banner in `ChatPanel.tsx`, bumped `maxOutputTokens` 300 → 1024 in
  `src/app/api/chat/route.ts`, added server-side `onFinish` logging.

### 4. Mic behavior fixes (`ChatPanel.tsx`)

- `recognition.continuous` `false` → `true` (was silently stopping after any
  pause).
- `handleSend` calls `recognitionRef.current?.stop()` and clears input.
- **Known Web Speech API race**: restarting the mic soon after stop can throw
  `InvalidStateError` (async teardown). Fixed with try/catch + auto-retry
  (up to 3×, 250ms backoff) around `recognition.start()`.

### 5. Full visual redesign — "Minimalist Monochrome"

Strict black/white editorial system across every component:

- **Fonts** (`layout.tsx`): Playfair Display / Source Serif 4 / JetBrains
  Mono via `next/font`.
- **Tokens** (`globals.css`): `--color-ink` #000, `--color-paper` #fff,
  `--color-muted` #f5f5f5, `--color-muted-ink` #525252, `--color-hair` #e5e5e5,
  exposed via `@theme inline`. Subtle global texture overlay.
- **Centralized primitives** (`src/lib/styles.ts`): `buttonPrimary`,
  `buttonOutline`, `buttonGhost`, `buttonIcon`, `fieldInput`, `fieldLabel`,
  `panel` — every component uses these.
- Zero border-radius, zero shadows. Emphasis via inversion, not color.
- **Bug found & fixed**: an unconditional `outline-none` on `fieldInput`
  permanently pinned the shared `--tw-outline-style` CSS variable to `none`,
  which `focus-visible:outline-*` reads but never resets — no focus ring ever
  rendered, anywhere. Removed the unconditional class; verified via
  `getComputedStyle` + real Tab navigation.
- Fixed slider-label overlap (mono uppercase didn't fit) — shortened labels,
  loosened tracking.

### 6. Voice settings panel + presets + test button

- `VoiceSettingsPanel.tsx` — 4 sliders (Stability/Similarity/Style/Speed) +
  Speaker Boost checkbox, matching ElevenLabs' `voice_settings` fields
  exactly.
- **"Test voice"** button plays a fixed test line through `/api/tts` using
  current slider values.
- **4 preset slots** (`VoicePresetButtons.tsx`) — click empty to save, click
  filled to load, hold (~550ms) to overwrite. Stored in
  `StudioState.voicePresets`, persisted.

### 7. Layout: chat panel narrowed (round 1)

Grid went `1.4fr_1fr` → `17fr_7fr` (chat column ≈70% of original width, 30%
narrower), freed space to the canvas column.

### 8. Flow-diagram canvas: pan/zoom infinite canvas

`PlaybookCanvas.tsx` restructured into a Figma-like infinite canvas:

- Fixed-height `overflow-hidden` viewport; image in an absolutely-positioned
  layer with `transform: translate(x,y) scale(scale)`, `transform-origin: 0 0`.
- Scroll/swipe → pan. Ctrl/Cmd+scroll or pinch → zoom toward cursor. Native
  (non-passive) `wheel` listener in `useEffect`, not React's `onWheel`
  (passive-listener ambiguity breaks `preventDefault()` there).
- Click-drag on empty canvas → pan; hotspots marked `data-hotspot` so the pan
  handler's `closest('[data-hotspot]')` check excludes them.
- `+`/`−` zoom buttons, live percentage readout, **"Reset view"** button.
- Hotspot drag/resize math needed zero changes — already scale-invariant
  (screen-space delta / current `getBoundingClientRect()` size).

---

### 9. GitHub push + layout narrowed again (round 2)

- Repo created and pushed: `gh repo create --source=. --remote=origin --push`
  → https://github.com/GPonGithub/gallery-guide-studio.
- User asked to narrow the chat panel **and voice controls** by another 30%
  on top of round 1. Current grid in `page.tsx`:
  `lg:grid-cols-[minmax(0,191fr)_minmax(0,49fr)]` — this specific
  `minmax(0, Nfr)` form, not bare `fr`, was required (see gotcha below).
- **Gotcha discovered**: bare `fr` tracks on a CSS Grid respect the content's
  *intrinsic* min-width as a floor (`min-width: auto` default) — so narrowing
  the ratio alone silently did nothing, and looked exactly like a caching bug
  (checked fresh tabs, fresh ports, cleared `.next`, all identical). Fixed
  with `minmax(0, Nfr)` on both tracks + `min-w-0` on the chat wrapper div.
  That then made the voice-controls row overflow/overlap at the new narrower
  width — fixed by adding `flex-wrap` to that row in `ChatPanel.tsx`.

### 10. Playbook editor modal: resized + basic-instructions template + per-box generate

`PlaybookEditorModal.tsx`:

- Resized 150% taller / 100% wider: `max-w-lg`→`max-w-5xl` (512px→1024px
  exact), textarea `h-56`→`h-[560px]` (224px→560px exact).
- New **"+ Basic instructions"** button (`buttonOutline`) inserts a
  `## Personality` / `## Flow` / `## Rules` / `## Edge cases` numbered-list
  template (`BASIC_INSTRUCTIONS_TEMPLATE` constant), appended to existing
  content if any.
- New **"Generate prompt"** button (`buttonPrimary`) next to it, with local
  `isGenerating` state — calls a new `onGeneratePrompt: () => Promise<void>`
  prop, which `page.tsx` wires to a new `generateSinglePlaybook(boxId)`
  function (separate from the existing bulk `generatePlaybooks()`). Confirms
  before overwriting if the box already has content. Caption text: "Generate
  prompt updates only this playbook, using your master playbook and any
  others as reference."

### 11. Relaxed the "need a hand-written reference" requirement

Both `generatePlaybooks()` and `generateSinglePlaybook()` in `page.tsx` used
to refuse to run if zero boxes had hand-written instructions. Changed the
guard to `references.length === 0 && !state.masterPlaybook.trim()` — so a
master playbook alone is now enough context; only block if *both* are empty.

`src/app/api/generate-playbooks/route.ts` updated to match: the "match
reference style" prompt block is now conditional on `references.length > 0`;
added an `else` branch telling the model to establish the format itself from
the master-playbook context, defaulting to the same
Personality/Flow/Rules/Edge-cases structure (consistent with §10's template)
when there's no reference and nothing more specific implied.

### 12. Fixed: Reset View / initial auto-fit computing garbage scale

**Bug**: `fitToFrame()` (the "frame the PNG within the frame" logic) was
sometimes called before the CSS Grid viewport had finished layout, reading a
near-zero `getBoundingClientRect()` and locking in a `scale` clamped to
`MIN_SCALE` (0.1) that nothing ever recalculated — reproducible on a real
complex diagram (2400×900, 18 boxes): expected fit was 39.6%, actual was
stuck at 10% (or occasionally the un-fit default `scale(1)`), and manually
clicking Reset View afterward always fixed it — proving `fitToFrame()`'s math
was correct and the bug was purely about *timing* of the first call.

- First attempt (double `requestAnimationFrame`) was tested and found
  insufficient — rAF can stall while the Browser pane is hidden/backgrounded,
  a real robustness concern beyond just this test environment.
- **Final fix** (`PlaybookCanvas.tsx`): `fitToFrame()` itself now refuses to
  act on a near-zero viewport (`rect.width < 2 || rect.height < 2`) so no
  caller can ever lock in a bogus scale. A `ResizeObserver` watches the
  viewport and retries `fitToFrame()` whenever its real layout size changes.
  Because `ResizeObserver` only fires on an actual size *change* — if the
  viewport happens to already be at its final size when observed, it may
  never fire again — `handleImageLoad` explicitly re-arms it
  (`unobserve`+`observe`) whenever its own immediate `fitToFrame()` attempt
  didn't yet see a usable size, forcing one more guaranteed "initial
  observation" callback per the ResizeObserver spec.
- **Verified live** in the browser with a fresh 2400×900/18-box test image
  (uploaded via a synthetic `DataTransfer`, not manually): the very first
  render after upload landed at exactly `scale(0.395592)`,
  `translate(0px, 101.983px)` — the mathematically correct centered fit,
  matching what Reset View itself produces — with no manual click needed.
  Reset View re-tested afterward reproduces the identical transform.
  Typecheck/lint/build all pass.

### 13. Added: "Clear image & boxes" button

`PlaybookCanvas.tsx` — new toolbar button right after "+ Add playbook box":

```tsx
const clearAll = () => {
  if (!imageDataUrl && boxes.length === 0) return;
  const proceed = window.confirm(
    'This removes the uploaded image and every playbook box, including their written instructions. Continue?',
  );
  if (!proceed) return;
  naturalSizeRef.current = null;
  setView({ scale: 1, x: 0, y: 0 });
  onClearAll();
};
```

Disabled when there's nothing to clear. New `onClearAll` prop wired in
`page.tsx` to reset `imageDataUrl`, `imageName`, `boxes`, `activeBoxId` to
empty. **Typecheck/lint/build all pass**, but the live confirm-dialog click
flow was not exercised end-to-end in the browser before the session was
paused (was mid-test — uploaded a synthetic SVG and clicked "+ Add playbook
box" to set up the scenario — when the user interrupted with "stop"). Worth a
quick manual click-through before considering it fully verified, though the
code path is simple and the surrounding parts (state reset shape) are
identical to patterns already proven elsewhere in `page.tsx`.

---

## Current file map

```
src/
  app/
    layout.tsx               — fonts (Playfair/Source Serif/JetBrains Mono)
    globals.css               — design tokens, texture, base styles
    page.tsx                  — header, grid layout, all modals wired up,
                                 generatePlaybooks(), generateSinglePlaybook()
    api/
      chat/route.ts            — streamText + changeStage tool
      detect-labels/route.ts   — marker-based vision label reading
      generate-playbooks/route.ts — bulk + single, reference-optional
      tts/route.ts              — GET, streams ElevenLabs, voice_settings from query
  components/
    PlaybookCanvas.tsx         — pan/zoom canvas, hotspot CRUD, auto-detect,
                                  clearAll()
    ChatPanel.tsx              — useChat, mic, TTS playback, voice settings row
    VoiceSettingsPanel.tsx     — 4 sliders + speaker boost checkbox
    VoicePresetButtons.tsx     — 4 save/load/overwrite slots
    PlaybookEditorModal.tsx    — per-box instructions, basic-instructions
                                  template, per-box "Generate prompt"
    MasterPlaybookModal.tsx    — global context, autosave
    ApiKeysModal.tsx           — key entry + clear
  lib/
    types.ts                   — StudioState, PlaybookBox, VoiceSettings
    storage.ts                  — localStorage load/save, defaults
    styles.ts                   — buttonPrimary/Outline/Ghost/Icon, fieldInput, panel
    detectHotspots.ts           — blue-button CV detection + marker annotation
    anthropicModel.ts           — client-key-or-env-fallback provider builder
```

## Known limitations (carried over from REBUILD_SPEC.md, still true)

- No knowledge-base/PDF upload, no TouchDesigner/OSC authoring, no
  multi-user — out of scope, not implemented.
- No Figma live-import (org Figma seat licensing issue) — PNG export +
  auto-detect is the workflow.
- No truncation-detection heuristic (built, then removed upstream of this
  session) — worth revisiting if truncated replies show up.

## Things to verify with a real API key / real browser (this session's tools block mic + can't hold real keys)

- Real end-to-end voice test with a live ElevenLabs key.
- Real microphone continuous-listening + restart-race fix under actual audio
  input (mic access blocked in this session's browser pane).
- Auto-detect label reading accuracy on the user's actual uploaded diagrams
  with a working Anthropic key.
- **"Clear image & boxes" button** (§13) — implemented and type/lint/build
  clean, but not yet clicked through live with the confirm dialog.

## Immediate next step for a fresh session

1. Confirm with the user whether the uncommitted changes (git status —
   5 modified files, see "Repo / GitHub" above) should be committed/pushed.
2. If continuing verification work: reload the dev server, clear
   `localStorage` (`gallery-guide-studio:v1`), upload a test image, add a
   playbook box, click "Clear image & boxes", confirm the dialog, and check
   both the image and box are gone. Clean up any synthetic test files
   afterward (mirror the pattern used throughout this session — don't leave
   test images in `public/` or test state in the dev browser's localStorage).

## Session state notes

- Dev server URL changes on every restart — don't assume a prior URL still
  works; check the current preview/run result.
- Browser localStorage key: `gallery-guide-studio:v1`. Test sessions in this
  environment repeatedly wrote and cleared this key with synthetic data —
  the user's own browser holds their real state, separate from this
  session's sandboxed browser pane.
- Two untracked PNGs (`APPOINTMENT FLOW CHART_02.png`, `_03.png`) sit at the
  repo root — not created by this session, don't touch without asking.
