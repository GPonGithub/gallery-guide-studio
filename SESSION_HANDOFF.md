# v3 session handoff — step-engine rebuild, night 1

Picking this up tomorrow: read this file first, then the full technical
plan at `/Users/grahamplumb/.claude/plans/buzzing-meandering-dawn.md` (still
there, not deleted) if you need the exact design rationale for anything
below. `HANDOFF.md` in this same folder is the *original* v2→v3 handoff
(architecture problem + step-table concept) — still accurate background,
not superseded by this file.

## Where things stand

**The rebuild described in HANDOFF.md is implemented and typechecks/builds/
lints clean.** What's *not* done yet: live-testing the actual conversation
flow against a real model (no Anthropic API key was available in last
night's environment — see "First thing tomorrow" below).

- Repo: this folder (`Immersiive Lab UI Design_v3`) is now its own git
  checkout of `github.com/GPonGithub/gallery-guide-studio`, on branch
  **`v3-step-engine`** (tracking `origin/main`). `npm install` already ran.
  **Nothing has been committed yet** — all of tonight's work is sitting as
  uncommitted local changes (`git status` shows 10 modified files + the
  untracked `HANDOFF.md`). That was deliberate — didn't want to commit
  before you'd seen it run. Decide tomorrow whether to commit as one chunk
  or in pieces.
- v2 itself is untouched at `../Immersiive Lab UI Design_v2`.

## What actually changed (the step-engine rebuild)

Every box's free-form `instructions: string` is gone, replaced by an
ordered `steps: PlaybookStep[]` table — each step is `BOT` (agent speaks),
`USER` (wait for a reply, optionally saving it to a named variable), or
`NAV` (jump to another box; unconditional if it's the only NAV at that
point, or a branch to classify between if there are several in a row).
**The app now walks this table mechanically** — the server (`/api/chat`)
decides sequencing/transitions from table structure, not from an LLM
judgment call each turn. Full rationale for why this fixes v2's five
documented failure modes is in `HANDOFF.md`.

Files touched (all in this repo, none in v2):

- **`src/lib/types.ts`** — new `PlaybookStep`/`StepOption` types;
  `PlaybookBox.instructions` → `PlaybookBox.steps`; `StudioState` gained
  `activeStepIndex`, `variables`, `designerInitials`.
- **`src/lib/storage.ts`** — matching `defaultState` fields.
- **`src/app/api/chat/route.ts`** — full rewrite. The `walk()` function is
  the actual engine; see its doc comment for the exact rules, especially
  the "`canConsume`" logic that stops the visitor's very first kickoff
  message from being misread as the answer to the table's first real
  question. Replaced the old `changeStage` tool with a custom
  `data-position` stream part (deterministic, app-computed — see
  `createUIMessageStream` usage) carrying the new `{boxId, stepIndex,
  transitions, variableUpdates}`.
- **`src/app/api/generate-playbooks/route.ts`** — AI-assisted generation
  now outputs step arrays (with the model assigning `variable` names and
  `navTarget` ids) instead of prose.
- **`src/app/api/sync-figma/route.ts`** — a synced box's raw Figma text now
  seeds a single BOT step instead of populating `instructions`.
- **`src/components/PlaybookEditorModal.tsx`** — rebuilt as the 10-row,
  7-column table from your screenshot (STEP / BOT·USER·NAV / INSTRUCTION /
  VARIABLE / Send to TD / Save to sheet / Designer ID). Rows fill
  sequentially (no gaps); NAV rows get an inline target picker prioritized
  by `leadsTo` (real Figma neighbors) when present. **Confirmed with you
  tonight: this table is the popup editor (click a box to open it) — the
  canvas itself still shows the plain compact box like today, not the
  table inline.** The two blank buttons next to "OPEN PLAYBOOK EDITOR" in
  your mockup are intentionally *not* built yet — you said not decided,
  I'll build them once you say what they do.
- **`src/components/ChatPanel.tsx`** — dropped the old `changeStage`-tool
  handling and the empty-reply auto-retry machinery (both were mitigations
  for failure modes the step engine makes structurally impossible now).
  Reads the new `data-position` data part instead; shows a small read-only
  "Variables:" strip for captured values.
- **`src/app/page.tsx`** — wiring: `activeStepIndex`/`variables` plumbed
  through, box index passed to the editor (drives the "PLAYBOOK N : LABEL"
  header and the Designer ID prefix), generate-playbooks calls updated for
  the new response shape.
- **`src/components/ApiKeysModal.tsx`** — added a "Designer initials" field
  (e.g. `GP`) that feeds the auto Designer ID column (`GP_01_01`, etc).
- **`src/components/PlaybookCanvas.tsx`** — trivial: new-box defaults now
  `steps: []` instead of `instructions: ''`.

"Send to TD" and "Save data to sheet" are wired as inert persisted
checkboxes only — no TouchDesigner/sheet integration, matches HANDOFF.md's
"that's separate, later scope." You said you'd explain both later.

## Verified tonight

- `npx tsc --noEmit` — clean (the one `LayoutProps` error in `layout.tsx`
  is a Next.js generated-types artifact, gone as soon as `npm run build`
  or `npm run dev` runs once; unrelated to anything touched here).
- `npm run build` — succeeds.
- `npm run lint` — clean.
- Manual browser pass (via a synthetic uploaded test PNG, not a real
  diagram): image upload works, "+ Add playbook box" works, the editor
  modal opens on box click with the exact 10×7 table shape, and setting a
  row's option to `BOT` + typing an instruction correctly creates a real
  step in state (confirmed via `localStorage` inspection). Also created two
  extra empty boxes ("Playbook 2", "Playbook 3") as NAV-target scaffolding
  for the next test.

## NOT verified — first thing tomorrow

**The actual conversation engine has never run against a real model.**
There's no `ANTHROPIC_API_KEY` in this machine's shell env and none was
pasted in before we paused. To pick this up:

1. Restart the dev server (`.claude/launch.json` already configured — port
   3000, or whatever's free) and open it, or just `npm run dev` in this
   folder.
2. Enter a real Anthropic API key in the app's "API keys" panel (stored
   client-side only, same as before).
3. Rebuild — or just re-verify, since it may still be in that browser
   profile's `localStorage` from tonight — the reference table on
   "Playbook 1":
   ```
   1  BOT   Welcome the patient and ask for their name.
   2  USER  Patient says their name.          → variable: user_name
   3  BOT   Ask the patient if this is an emergency.
   4  NAV   If it is an emergency, go to Playbook 2.
   5  NAV   If it is not an emergency, go to Playbook 3.
   ```
   (Only step 1 was actually typed in through the UI tonight — the rest
   still needs building, either by hand or you can just try "Generate
   prompt" once a key is in.)
4. Give Playbook 2 and Playbook 3 each one simple BOT step so a NAV jump
   has something to say immediately.
5. Run the conversation and confirm the full verification checklist from
   the plan file: step 1 speaks on the first message; naming yourself
   advances past step 2 and the name shows up in the Variables strip; step
   3 speaks; answering the emergency question correctly classifies and
   jumps to the right box with a "Moved to" banner; the old empty-turn
   "Note" banner never appears during normal flow.

## Open decisions for tomorrow

- Commit this work? Nothing's committed yet — branch `v3-step-engine`
  only exists locally right now, not pushed.
- What do the two blank buttons in your mockup (next to "OPEN PLAYBOOK
  EDITOR") do? Not built yet, waiting on you.
- Semantics of "Send to TD" and "Save data to sheet" — you said you'd
  explain later; still just inert checkboxes.
