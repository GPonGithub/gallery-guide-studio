# Gallery Guide Studio v3 — Handoff

This is a clean, empty folder. It exists because v2's conversation-reliability
problems turned out to be architectural, not a prompt-wording problem — read
below before writing any code. **v2's codebase is a good starting point, not
something to avoid**: almost everything in it (image upload, the pan/zoom
canvas, hotspot editing, voice/TTS, API key management, the Figma direct-sync
integration) works well and has nothing to do with the reliability problem.
The part that needs to be rebuilt is specifically *how a playbook decides
what to say and when to transition, turn by turn*.

**Recommendation for a fresh v3 session: copy v2's codebase into this folder
as the starting point**, then do the step-engine rework described below.
Don't rebuild from scratch.

- v2 lives at `../Immersiive Lab UI Design_v2`, pushed to
  **https://github.com/GPonGithub/gallery-guide-studio** (public,
  `origin/main`), commit `2c0ed5a` as of this handoff. Working tree was clean
  at handoff time except two untracked reference PNGs at the repo root
  (`APPOINTMENT FLOW CHART_02.png` / `_03.png`) that predate this session and
  several more (`_04` through `_17`) added during it — all are the user's own
  diagram exports, not app assets; leave them alone unless asked.
- v2's own `SESSION_HANDOFF.md` (in that folder) covers everything from the
  session *before* this one — original architecture, the latency-tuning
  rationale, and sections 1–13 of incremental fixes. Still accurate for the
  parts of the app this handoff says to keep. Not duplicated here.

---

## Why v3 exists — the actual problem

v2's chat architecture asks a single LLM call, once per turn, to
simultaneously (a) decide what to say and (b) decide whether/where to
transition to a different "playbook" (stage), based on a paragraph of
free-form prose instructions per box. Across one very long session, we found
and fixed **five distinct manifestations of the same underlying reliability
gap** — the model's own judgment about "have I dealt with this yet, should I
speak, should I transition" being unreliable when a box's instructions ask it
to track more than one condition at once, or reason across earlier turns.
Prompt engineering measurably helped (see the fix log below) but a new
instance of the same failure class kept resurfacing in a different box each
time. That's the signal this is an architectural ceiling, not a wording
problem — see the "five failure modes" section below for the concrete
evidence trail.

**The direction we landed on** (discussed at length with the user, not yet
built): replace free-form per-box prose with an explicit, ordered **step
table** per playbook, so the *app* — not the model's judgment — controls
sequencing.

---

## The v3 design: step-table execution

Each playbook becomes an ordered list of steps instead of a paragraph. Each
step has:

| Column | Meaning |
|---|---|
| **Step** | Order, 1 → N |
| **Option** | One of `BOT` (bot speaks this turn) / `USER` (wait for the patient's answer) / `NAV` (jump to another playbook — immediate, unconditional) |
| **Instruction** | What to say/ask, or which playbook a NAV step jumps to |
| **Save VARIABLE** | Optional — extract a named variable from the user's last answer (e.g. `user_name`) |
| **Send to TD** | Optional — propagate that variable out to TouchDesigner |

Reference example the user sketched for Playbook 1 (5 active rows, table
padded to 10):

```
1  BOT   Welcome the patient and ask for their name.
2  USER  Patient says their name.                    → save: user_name → send: user_name
3  BOT   Ask the patient if this is an emergency.
4  NAV   If it is an emergency, go to Playbook 2A.
5  NAV   If it is not an emergency, go to Playbook 2B.
```

### Why this should actually fix the reliability problem

Today, the model has to *decide* whether to call `changeStage` in the same
breath as generating text, based on prose it has to interpret fresh every
turn. In the step model, the **type** of the current step tells the app
mechanically how to know when it's done — a BOT step is done the instant
it's spoken, a USER step is done the instant an answer comes back, a NAV
step is an immediate jump with nothing to wait on. The app walks the list;
the LLM's job shrinks to "phrase this one line" or "extract one variable,"
never "decide what happens next across a whole paragraph of conditions."

### What this does *not* eliminate — be honest about this up front

1. **Conditional NAV steps still need a judgment call.** Steps 4 and 5 above
   both start with "if" — something still has to classify the patient's last
   answer to pick between them. The table makes the *branch itself*
   deterministic, not the *decision of which branch*. Smaller and more
   isolated than today's risk (one bounded classification instead of a whole
   paragraph of interacting conditions), but not zero. Don't be surprised
   when this needs its own hardening pass.
2. **This trades conversational flexibility for reliability, on purpose.**
   If a patient answers three questions in one breath ("Hi, I'm Graham, pay a
   bill, not an emergency"), a strict step walker doesn't naturally give
   "credit" for steps 2–4 unless that's explicitly built — and building it
   risks reintroducing the exact "did they already tell me this" logic that
   caused today's worst failures (see Playbook 1 / 2B below). The user has
   accepted a more one-question-at-a-time, slightly less natural feel as the
   tradeoff. Don't quietly try to make it clever again.
3. **This is a genuine rebuild**, not a data migration. `PlaybookBox` needs a
   `steps: Step[]` shape (or similar) instead of a single `instructions:
   string`; the editor UI needs a real table instead of a textarea; `/api/
   chat` needs to track *position within a playbook*, not just *which
   playbook is active*. Budget for this accordingly.
4. **"Send to TD" is new scope, not a byproduct.** There is no TouchDesigner
   or OSC integration anywhere in v1/v2 — REBUILD_SPEC (the original v1
   spec) explicitly lists it as out of scope. Likely an OSC or WebSocket
   client from the Next.js server out to a running TouchDesigner instance,
   with some mapping from variable name → TD parameter. Treat as a separate
   milestone after the step-engine reliability rework, not bundled into it.

---

## The five failure modes found this session (evidence, not theory)

These are documented in detail in this session's transcript; summarized here
because the step-engine design should specifically guard against recurrences
of each:

1. **Tool call without text.** The model transitions stages but the model's
   reply for that turn is generated under the *old* stage's system prompt
   (the new one isn't loaded until the next turn) — so it has nothing
   box-specific to say yet, and sometimes says nothing at all. Mitigated in
   v2 via an auto-regenerate-once-the-transition-lands retry (capped at 2
   attempts) and a "Note" banner as the last-resort fallback — reduced
   frequency, did not eliminate it (see #5).
2. **Text without a tool call.** The inverse: a box's instructions say "then
   move onto Playbook X," and the model says the line but never actually
   calls `changeStage` — it narrates moving on instead of doing it.
   Mitigated by reinforcing the system prompt to require both directions
   explicitly; not verified as fully closed before the session ended.
3. **Reading another box's content and reciting it early.** The system
   prompt includes a "menu" of other reachable boxes so the model can *pick*
   the right one — originally with a content preview for disambiguation.
   The model sometimes read that preview and spoke it verbatim while still
   formally in the old box, without transitioning. Fixed by making the menu
   preview label-only (no content) whenever real Figma connection data
   (`leadsTo`) has already narrowed the candidate list to a few genuine
   neighbors — full content preview is kept as a fallback for boxes without
   real connection data, where more disambiguating detail is still needed.
4. **Unreliable "have they already told me this" shortcuts.** Playbook 1 had
   a rule to skip straight to the matching playbook if the patient had
   already named a service *and* confirmed no emergency, potentially across
   separate earlier turns. This conditional-memory reasoning was the least
   reliable thing tested all session — it's the direct motivation for the
   step-table's "ask one thing, wait, route on that answer only, never
   shortcut based on remembering an earlier turn" principle.
5. **Confirmed via server-side debug logging (since removed) that some
   stalls never left the original box at all** — three consecutive
   auto-continue attempts, all still generated under the same stage's system
   prompt, meaning the model failed to call `changeStage` on every retry, not
   just once. This is the strongest evidence that the fix needs to be
   structural (the app enforcing sequencing) rather than another prompt
   rewrite — we were still finding new instances of this failure class after
   several rounds of prompt hardening, right up to when this handoff was
   written.

---

## What already works well and should carry forward as-is

- **Image upload + pan/zoom canvas** (`PlaybookCanvas.tsx`) — including a
  real, non-obvious fix: Tailwind's `max-width:100%` preflight reset was
  double-shrinking large diagram images against the zoom transform; fixed
  with `max-w-none` on the canvas `<img>`. Also: the auto-fit-on-load timing
  race (viewport not yet laid out when the image decodes) needed both
  padding-box-correct math *and* a multi-frame retry burst, not just one or
  the other.
- **Figma direct-sync** (`/api/sync-figma`) — reads a FigJam board's real box
  content and connector graph via the Figma REST API, given a user-supplied
  personal access token (stored client-side only, same pattern as the
  Anthropic/ElevenLabs keys). Replaced an earlier vision-based "read the
  diagram from a screenshot" approach entirely once this worked — it's
  strictly more accurate (real data, not guessed). Two things to know if
  touching this:
  - Box positions are normalized against the board's *measured content
    bounds*, expanded by an empirically-derived margin (content fills ~92%
    of a typical Figma "Export selection" PNG's width and ~90% of its
    height, centered) to match what an exported PNG actually looks like.
    This ratio was measured against one real export — may need
    recalibration if a differently-configured export doesn't match.
  - Getting read access required the Figma connector to be authorized under
    the correct identity — the CCA-managed boards needed `gplumb@cca.edu`
    specifically, not the user's personal `grahamsplumb@gmail.com` (the org
    locks down API access per-account, not just per-file). If a fresh Figma
    read starts failing with "you don't have edit access," check which
    account the connector is authorized as before assuming it's a code bug.
- **Voice/TTS, API keys modal, master playbook, box editor shell** — all
  functioned correctly throughout; no changes needed for v3 beyond wiring
  them to whatever replaces `instructions: string`.
- **"Show connections" (vision-based arrow overlay)** — kept intentionally
  simple: straight lines between box centers, not path-traced arrows. A more
  sophisticated version that traced actual arrow geometry was built and
  explicitly reverted because it was slower and less accurate — don't
  reintroduce that without being asked.

---

## Immediate next steps for a fresh v3 session

1. Confirm with the user: copy v2's codebase into this folder as the
   starting point (recommended), or start clean? If copying, decide whether
   v3 continues in the same GitHub repo (new branch) or gets its own — not
   yet decided as of this handoff.
2. Design the `steps: Step[]` data shape to replace `PlaybookBox.instructions:
   string` — needs at least `{ type: 'BOT' | 'USER' | 'NAV', instruction:
   string, saveVariable?: string, sendToTD?: string }`, plus wherever `leadsTo`
   ends up living now that NAV steps carry destinations directly.
3. Build the step-table editor UI (replacing the freeform textarea in
   `PlaybookEditorModal.tsx`) — the user's reference image shows a 10-row
   fixed table per playbook with an "Open playbook editor" trigger; ask
   whether 10 is a hard cap or should grow dynamically.
4. Rebuild `/api/chat/route.ts` around step-position tracking (current
   playbook *and* current step index) instead of whole-box freeform
   instructions.
5. Design the conditional-NAV classification step carefully — this is the
   piece most likely to reintroduce reliability risk if under-specified (see
   failure mode discussion above).
6. TouchDesigner/OSC integration is separate, later scope — do not bundle it
   into the reliability rework.
