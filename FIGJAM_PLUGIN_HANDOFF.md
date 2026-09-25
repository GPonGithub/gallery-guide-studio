# v3 session handoff — FigJam plugin + live-sync toolchain

**Update #4 — Phone testing shipped and working; hands-free voice built
but PAUSED MID-DEBUG on a real iOS bug, read this one first:** this
session added a way to test the actual conversation on a phone (works),
and a hands-free "always listening" voice mode (does not reliably work on
iPhone yet — this is exactly where we stopped). Read the whole "Hands-free
voice mode" section below before touching that code again; skimming it
will waste time re-deriving what's already been ruled out.

## Small fixes shipped this session (working, not in question)

- **`Clear Blue Buttons`** — new red button, top-right of the canvas,
  clears just the detected boxes (not the PNG). `PlaybookCanvas.tsx`.
- **Detect Blue Buttons label-matching bug, fixed** — the vision model
  reads a card's whole printed title, e.g. `"PLAYBOOK 1: WELCOME"`, but
  synced Figma content is keyed on just `"WELCOME"` (the label half,
  parsed server-side). Detected titles are now run through the same
  `PLAYBOOK <code>: <label>` pattern before matching — new shared
  `src/lib/playbookTitle.ts`, used by both `PlaybookCanvas.tsx` and
  `sync-figma/route.ts` so there's one source of truth for the pattern.
  Verified against a synthetic two-card case end to end.
- **Hotspot rendering simplified** — a matched box used to render its full
  step table crammed inside the tiny detected-button rectangle, obscuring
  the real button graphic already in the PNG. Now the hotspot is just a
  transparent, resizable click target (`PlaybookCanvas.tsx`); all content
  lives in the editor modal only.
- **`/api/chat` latency** — two changes: (1) the common single-turn shape
  (a USER step with a variable, immediately followed by a BOT run) now
  extracts the answer and phrases the reply in *one* model call instead of
  two sequential ones (`extractAndPhrase`, with a fallback to the original
  two-call path if the merged call fails — see the token-budget comment
  there). (2) Plain extraction/branch-classification calls now run on
  Haiku 4.5 instead of Sonnet 5. Backup of the pre-change file is at
  `/private/tmp/claude-501/.../scratchpad/chat-route.pre-latency-fix.ts` on
  this machine if a full revert is ever wanted.
- **Generate Steps in FigJam was silently broken, now fixed** — jobs used
  to be matched to a board via `figma.fileKey`, but that Plugin API field
  is **only ever populated for privately-published org plugins** (Figma's
  own docs) — never for a locally-imported dev-mode plugin like this one.
  The plugin's poll loop was checking that field before ever polling, so
  it silently never picked up a job. Fix: dropped per-board matching
  entirely — `src/lib/figmaJobStore.ts` is now a single shared queue (this
  already only ever supports one app + one plugin session on one machine
  at a time, so there was nothing a second key was disambiguating).
  Touches `figma-jobs/route.ts`, `PlaybookCanvas.tsx`,
  `figjam-plugin/{code.js,ui.html}`. Confirmed working against the user's
  real board this session.

## Phone testing (shipped, working)

New, fully additive feature — a **"📱 Phone testing"** button in the main
app's header opens a modal (`PhoneTestingModal.tsx`) that encodes the
current boxes/masterPlaybook/voice settings into a URL fragment
(`src/lib/phonePayload.ts`, base64url — deliberately excludes API keys and
image/Figma-connection data) and shows it as a link + QR code (`qrcode`
npm package, client-side only, no external service). The link opens
**`/phone`** (`src/app/phone/page.tsx`) — a new, separate, minimal page:
just the chat/voice UI, no editing canvas, with its own tiny
`localStorage` slot for API keys (`gallery-guide-studio:phone-keys`) kept
completely isolated from the main app's saved state. It's a one-time
snapshot, not a live sync — regenerate the link after editing playbooks.

**Getting a phone to actually reach `localhost:3000` needed two real
fixes, both required, in this order:**

1. **A tunnel.** `ngrok` was tried first and failed consistently —
   TLS handshake failures with essentially zero response from ngrok's edge
   (confirmed via curl, openssl, and the user's own Chrome — not a
   client-side issue). Root-caused to the user's home network (Xfinity)
   most likely running "Advanced Security" or similar, which blocklists
   known tunneling-service domains at the TLS/SNI layer — DNS resolved
   fine, general HTTPS worked fine, only `*.ngrok-free.dev` specifically
   failed. **Switched to Cloudflare Tunnel (`cloudflared tunnel --url
   http://localhost:3000`, a `*.trycloudflare.com` quick tunnel, no
   account needed) and it worked immediately.** If ngrok is ever wanted
   again, it may just need that security feature disabled on the router;
   not otherwise a code problem.
2. **`allowedDevOrigins` in `next.config.ts` — do not delete this.**
   Without it, `next dev` silently blocks cross-origin dev-server requests
   by default (a CSRF-style protection), which doesn't error visibly — the
   static JS/CSS all 200s, but the app hangs on "Loading…" forever because
   the client-side bootstrap never completes. This is *not* specific to
   Cloudflare; it'll bite any tunnel/non-localhost origin, ngrok included.
   Current config covers `*.trycloudflare.com`, `*.ngrok-free.app`, and
   `*.ngrok-free.dev`. A real production deploy wouldn't hit this at all
   (dev-only protection) — only matters for tunneling a local dev server.

Both processes are local, ephemeral, **not started automatically** and
won't survive a reboot/terminal close:
```
npm run dev                              # port 3000
cloudflared tunnel --url http://localhost:3000   # prints a fresh *.trycloudflare.com URL every time
```
The free-tier Cloudflare URL changes on every restart — the app's own
"📱 Phone testing" link/QR always reflects whatever origin the *desktop*
browser is currently on, so just reopen the app at the new tunnel URL and
regenerate the link/QR from there, same as the very first time.

## Hands-free voice mode — built, but paused here, NOT working reliably

New second mic button (🎙️, blue) next to the existing 🎤/Send in
`ChatPanel.tsx`: stays open continuously, auto-sends N seconds after you
stop talking (adjustable 0–3s slider, "Hands-free pause", next to Reset
Conversation), and mutes itself while the bot is speaking so it can't hear
its own voice. **Manual mic + Send is untouched and still works exactly as
before** — this was built as a fully separate, independently-toggleable
path from the start specifically so it's safe to keep debugging without
risking the one thing that already worked. If hands-free mode is ever
abandoned, deleting it is a clean, contained removal.

**This is the unresolved part.** On a real iPhone (Safari — confirmed
identical engine to "Chrome" on iOS, since Apple mandates WebKit for every
iOS browser, so switching browsers won't help), it has gone through
several rounds of real bugs found and fixed, but as of pausing, **it still
fails** — most recently: works for exactly one exchange, then stops
responding to speech at all, with no confirmed recovery. In rough
chronological order, what's been found and fixed so far:

1. **iOS autoplay block on TTS replies** (confirmed via `NotAllowedError`
   in the dev server's forwarded console logs — this technique, reading
   `preview_logs` while the phone is actively being used, is how every
   real bug in this section got diagnosed; the dev server logs whatever
   the connected browser's console logs, phone included). First fix
   (unlocking a throwaway silent `Audio` object on tap) was **insufficient**
   — iOS's unlock is tied to the *specific element* that played, not the
   page. Real fix: one shared, persistent `<audio>` element
   (`sharedAudioRef`), unlocked via `unlockAudio()` called from both mic
   buttons' tap handlers, reused for every reply's playback instead of a
   fresh `new Audio()` each time.
2. **Duplicate sends at low pause settings** (e.g. 0.4s) — recognition
   restarted immediately after auto-send, before the bot had started
   speaking, and picked up the visitor's own trailing audio as a "new"
   utterance. Fixed with a 700ms cooldown before listening resumes after a
   send, plus a 4s duplicate-text guard (`lastAutoSendRef`).
3. **A real regression introduced while fixing #2's beep frequency**: gated
   mic restart on `status === 'ready'` (from `useChat`) to avoid a wasteful
   restart-then-immediate-stop cycle around each reply. But `status` also
   lands on `'error'` after any single failed request, and nothing but a
   fresh `sendMessage()` ever clears it — so gating on `'ready'` strictly
   permanently wedged the mic off after any one hiccup. Fixed with
   `isRequestInFlight(status)` (`submitted`/`streaming` only) so both
   `'ready'` and `'error'` correctly allow the mic to resume.
4. **No visible "why isn't it listening" cue** — the paused/listening
   states only ever showed in a `title` tooltip, which never displays on a
   touchscreen. Added an always-visible status line above the mic row:
   "Listening…" / "Bot is speaking — mic paused…" / "Waiting for a
   reply…" / "Reconnecting the mic…", each with a small dot indicator.
5. **A genuine React error caught mid-session**, from the dev server logs:
   `"The final argument passed to useEffect changed size between renders"`
   — the phone's tab was running stale code when a newer version (with a
   longer dependency array) got hot-swapped in underneath it, which
   corrupts that hook for the rest of the page's life. Shouldn't be
   possible through the tunnel (no live push — confirmed separately), but
   evidently slipped through once. Resolved by fully closing and reopening
   the tab (not just refreshing) — establishing "always fully close and
   reopen the tab after any server-side code change" as the safe habit
   for the rest of this debugging, not just a one-time fix.
6. **Suspected root cause of the remaining failure**: iOS/WebKit's
   `SpeechRecognition` can report itself as still actively listening while
   the underlying engine has silently stopped doing anything — no error,
   no `onend`, just dead air until iOS's own internal timeout (observed at
   20-30 seconds) eventually ends the session on its own. Added a
   watchdog: every 2s, if a session has produced zero activity (not even
   an interim result) for 8s, force it to restart rather than waiting on
   iOS. Hardened against calling `.stop()` repeatedly on the same
   already-stopping session (re-stamps activity the moment it forces a
   stop, so a slow-to-actually-end session isn't stopped again every tick
   — a real risk of making an already-flaky engine worse, not better).

**Status when paused**: shipped the watchdog + hardening, `tsc`/`lint`/
`build` all clean, but **not yet confirmed working** — the user's last
report (after the watchdog shipped) was actually *worse* than before it
(one exchange, then total failure, not even the old 20-30s eventual
recovery). We were mid-way through a structured diagnostic (asked the user
to correlate the audible iOS mic-on/mic-off system beep — unsuppressable,
confirmed real Apple/WebKit behavior, not ours to silence — against the
new on-screen status text, to narrow down exactly which failure mode is
occurring) when the user asked to pause for the night.

**Recommended first move tomorrow, not yet tried**: real remote debugging
instead of inferring from server logs. On the iPhone: Settings → Safari →
Advanced → **Web Inspector** (on). Connect the iPhone to a Mac (cable is
most reliable); on the Mac, Safari's **Develop menu → [device name] → the
open tab** gives a real, live console/network inspector attached to the
actual phone session — will show SpeechRecognition events, errors, and
timing directly, instead of the indirect (but so far effective)
"read the dev server's forwarded console logs" technique used for
everything above. This is likely to resolve the remaining bug much faster
than another round of guess-and-ship.

Worth an honest check-in with the user before sinking more time in,
though: if Web Inspector debugging doesn't crack it quickly, it may be
worth discussing whether iOS Safari's `SpeechRecognition` reliability is
fundamentally not solvable from app-side JS alone, and whether hands-free
mode should stay an experimental/best-effort feature (manual mic + Send,
which works fine everywhere, as the reliable fallback) rather than
something to keep investing in indefinitely.

---

**Update #3 — PNG-first restructure, read this one first:** everything
below (Update #2 and earlier) describes an architecture that's now
**mostly retired**. After Update #2's "Detect Blue Buttons via real Figma
card images" shipped, the user reported it didn't work against their real
board (no diagnosis ever obtained — see Update #2's own note about this),
and asked for a full re-think. The app is now **PNG-first**: students
upload a flat image of their board, everything (position, click targets,
content) is driven from that PNG plus real Figma content pulled in by
label match — not from Figma geometry, not from a live embed, not from
Figma-rendered card images.

**Current toolbar, left to right**: Connect FigJam file → Generate Steps
in FigJam → Upload image → Detect Blue Buttons → Update FigJam file →
Clear PNG.

**What changed**:
- **Sync FigJam File, Reset from Figma — deleted outright** (handler,
  state, `mergeSyncedBoxes`/`snapshotsMatch`, `PlaybookBox.lastSyncedSnapshot`,
  the whole Figma-geometry `figmaBoardExtent` reference-frame system). This
  was real, confirmed-unused code once nothing called it anymore, not code
  worth keeping dormant.
- **"Show live Figma board" and "Show connections" — buttons removed,
  code kept dormant** (per explicit user choice) — `viewMode`/`toEmbedUrl`/
  the iframe block, and `showConnections`/`connections`/the SVG arrows, are
  all still there, just unreachable without their button. Both trigger
  `eslint-disable` comments explaining why the setters are "unused."
- **Detect Blue Buttons now does two things at once**: the original
  vision-based position/title detection (`detectBlueHotspots` +
  `/api/detect-labels`, unchanged), *and*, if a FigJam file is connected,
  a real content pull (`fetchFigmaBoxes`, i.e. `/api/sync-figma`, also
  unchanged) matched to each detected button **by label** (trimmed,
  case-insensitive). A match reuses the real box's `id` (so `navTarget`/
  `leadsTo` stay internally consistent across the newly created box set)
  plus its real steps/instructionPrompt/figmaSourceId. No match (or no
  Figma connected) falls back to the original empty-steps behavior. This
  is the one place server-pulled Figma content still enters the app.
- **Generate Steps in FigJam no longer touches `state.boxes`** — it only
  triggers the plugin write and alerts success/failure. It used to
  auto-merge synced boxes onto the canvas using Figma-geometry positions;
  that positioning system doesn't exist anymore, so mixing it with
  PNG-pixel positions would have corrupted rendering. Upload a PNG and run
  Detect Blue Buttons afterward to actually see new content in the app.
- **Playbook editor is now real draft/Save/Cancel**, not live-editing
  (`PlaybookEditorModal.tsx`) — local `draftPrompt`/`draftSteps` state,
  seeded from the `box` prop, only reaches the app on Save; Cancel discards
  it. `onGeneratePrompt`'s contract changed from committing directly to
  *returning* the generated steps (`page.tsx`'s `generateSinglePlaybook`)
  so Regenerate also stages into the draft, not live app state.
  `page.tsx` passes `key={editingBox.id}` so the modal remounts (fresh
  draft) per box.
- **New "Update FigJam file"** — the write-back symmetrical to Generate
  Steps, same plugin-relay constraint (plugin must be open in Figma).
  `StudioState.figmaWriteDirty` flips true on any editor Save, false after
  a confirmed successful write. Button is `buttonOutline` (grey/disabled)
  when clean, a new `buttonSuccess` style (green — `src/lib/styles.ts`,
  explicitly called out as the second deliberate break from the monochrome
  system, same pattern as `buttonDanger`) when dirty. Gated behind
  `ConfirmDialog`. Only boxes with a real `figmaSourceId` get included in
  the write payload (nothing to write for a box that was never matched to
  real Figma content) — computes each step's exact Designer ID string via
  `src/lib/designerId.ts` and sends it, rather than making the plugin
  recompute IDs.
- **Job queue gained a `kind`** (`src/lib/figmaJobStore.ts`,
  `figma-jobs/route.ts`): `'generate'` (existing, default) vs
  `'apply-edits'` (new, carries `{ tables: [...] }` payload).
  `figjam-plugin/ui.html`'s poll loop branches on `job.kind` — same
  `log`/`done` relay either way, no changes needed there. `figjam-plugin/
  code.js` gained `applyEdits(payload)` — for each table, finds it by
  `figmaSourceId`, grows it if the app has more steps than it does (same
  `insertRow` pattern as `populateTable`), overwrites STEP/OPTION/
  INSTRUCTION/VARIABLE/DESIGNER-ID cells. **Known limitation, not solved
  this pass**: if the app has *fewer* steps than the real table (i.e. the
  student deleted a step locally), the extra existing Figma rows are left
  alone rather than removed — row deletion wasn't implemented.
- **"Clear PNG"** (renamed from "Clear image & boxes") — now clears only
  the image; boxes stay exactly where they are. Needed one real fix to work
  correctly: box positions are percentages *of the image's pixel
  dimensions*, so a new `StudioState.imagePixelSize` remembers those
  dimensions past the image being deleted (mirrors the old
  `figmaBoardExtent` pattern this removed). `fitToFrame`'s fallback chain
  is now `naturalSizeRef.current ?? imagePixelSize ?? VIRTUAL_CANVAS`.

**Verified this round**: `tsc`/`lint`/`build` clean throughout, `node
--check` on the plugin, a curl round-trip proving `kind`/`payload` survive
the job queue intact, and a full live browser pass with mocked
`fetch` calls (real Figma/Anthropic tokens still not available to me)
confirming: Detect Blue Buttons' by-label content match works exactly as
designed (matched box got the real id/steps/figmaSourceId, unmatched box
correctly fell back empty); the editor's Cancel truly discards an edit
while Save commits it and sets `figmaWriteDirty`; Update FigJam file's
button visibly goes grey→green→grey across a full mocked job cycle, and
the payload it sends is exactly right (only the Figma-linked box, correct
edited content, correct computed Designer ID); Clear PNG leaves boxes
positioned identically before and after.

**Not verified, and can't be from my side**: the plugin's `applyEdits`
actually writing into a real board — same standing limitation as every
plugin-side change this session, no Figma token/live plugin session
available to me. This is the first thing to test for real next time.

---

**Update, later the same session:** everything below this point describes
the state as of the Generate Steps feature. A lot changed after that —
summarized here, details in the file-by-file sections further down (search
for the filenames):

- **UI decluttering**: removed Upload image, the Auto-detect blue buttons
  feature entirely (`detectHotspots.ts`'s vision functions, `/api/detect-labels`),
  and + Add playbook box. "Connect FigJam file" always reads that now (no
  more Reconnect variant); "Sync from Figma" relabeled "Sync FigJam File";
  "Generate Steps" relabeled "Generate Steps in FigJam" and moved first in
  the toolbar.
- **Real bug found and fixed twice over**: the grid placement for
  Figma-synced boxes (no image) was first too tight (chips overlapped),
  then — after widening it — too generous relative to actual box count
  (boxes rendered tiny in a huge mostly-empty canvas). The real fix:
  `sync-figma/route.ts` now reads each playbook's **actual Figma geometry**
  (its background box's real `absoluteBoundingBox`, falling back to
  title→table span) and expresses every box's x/y/width/height as a
  percentage of the **real board's own bounding box** — not an abstract
  grid at all anymore. The API also returns `boardExtent` (that bounding
  box's real pixel size), stored as `StudioState.figmaBoardExtent` and used
  by `PlaybookCanvas.tsx` as the actual reference frame for rendering
  (`src/lib/canvasLayout.ts`'s `VIRTUAL_CANVAS` is now only a fallback
  before anything's ever been synced). Result: the app's canvas now
  reproduces the real board's actual relative layout.
- **Show connections rebuilt**: used to require an uploaded image and a
  vision API call (`/api/detect-connections`, now deleted) to *guess*
  arrows from a PNG. Since every box now comes from a real Figma sync
  (which already parses real `CONNECTOR` nodes into `box.leadsTo`), the
  arrows are just derived directly from that — no image, no API call,
  never stale.
- **Each box now shows a content preview** — the instruction prompt and a
  small Step/Type/Instruction/Variable/Designer ID table, rendered directly
  in the hotspot rectangle (not just a bare clickable outline). Designer ID
  computation was pulled into a shared `src/lib/designerId.ts`, now used by
  `PlaybookEditorModal.tsx`, `DesignerIdTableModal.tsx`, and this preview
  (previously duplicated twice).
- **The live Figma embed (the "portal") is back.** It was removed earlier
  this session as part of the decluttering pass (the "Show diagram" button
  the user asked to remove was actually the toggle for this — a
  consequence not flagged at the time). Once the app's own canvas still
  didn't satisfy "I want to see the real FigJam design" even after the
  geometry fix, the user asked directly whether recreating the board was
  ever the right call versus just showing the real thing — confirmed they
  want **the portal**, not a pixel-chase on the recreation. It's back as
  the "Show live Figma board" / "Show diagram" toggle, same as originally
  built (`toEmbedUrl`, Figma Embed Kit 2.0). **Lesson for next time**: the
  app's own canvas recreation is genuinely useful for the editing workflow
  (click a box → edit its steps) but was never going to be a substitute for
  literally showing the real board — don't over-invest in visual fidelity
  there again; point back to the embed instead.
- **Generate Steps** button/job-queue system (previous section) is
  unchanged by any of this.
- New file: `src/lib/canvasLayout.ts` (VIRTUAL_CANVAS fallback + doc),
  `src/lib/designerId.ts` (shared helper).
- All of the above verified via `tsc`/`lint`/`build` (clean) and repeated
  live browser passes with synthetic data mimicking real sync responses —
  **still never run against the user's actual board from my side** (no
  Figma token available to me); the user has been testing directly with
  their own token and reporting back screenshots, which is how each of
  these bugs was actually found.

---

**Update #2, stopping for the night here — pick up from this point
tomorrow.** Since the portal came back, a lot more happened. In order:

1. **"Detect Blue Buttons" — built, then abandoned by the user as not
   working.** The idea: since the live embed's clicks can't be intercepted
   (real, hard cross-origin wall — see below), fetch a *real rendered image*
   of each card from Figma's own Images API, show it inside the app's
   already-correctly-positioned boxes, and overlay a precise clickable
   region at the real button's rect (also read from Figma: `sync-figma`
   now finds the "OPEN PLAYBOOK EDITOR" shape below each table and returns
   its rect as a percentage of the card, via new `findOpenEditorButton` in
   `sync-figma/route.ts`; `PlaybookBox` gained `figmaBgNodeId` and
   `buttonRect`). New route `src/app/api/figma-card-images/route.ts` calls
   `GET /v1/images/:file_key?ids=...&format=png`. I tested this myself with
   a **mocked** fetch response (fake SVG standing in for a real Figma
   render) and confirmed the mechanics work — image swaps in, click on the
   button region opens the editor, click elsewhere on the card does
   nothing. **But the user reported "this isn't working" against their real
   board, with no further diagnostic detail given before they redirected to
   a different approach.** I never found out *why* — could be the
   `findOpenEditorButton` geometry heuristic missing the real button
   (unverified against real data), a Figma Images API quirk, or something
   else entirely. **Don't assume this feature works. If revisited, get a
   real error/screenshot from the user first — don't just re-verify with
   mocks again**, that already happened once and didn't catch whatever's
   actually wrong.
2. **Cross-origin constraint, explained to the user and worth remembering**:
   the live embed (`iframe` to `embed.figma.com`) is a different origin.
   Browsers categorically block reading its DOM/pixels or intercepting
   clicks inside it — not a bug, not solvable with more code, not solvable
   by controlling pan/zoom from our side either (the user asked; explained
   why that doesn't help — knowing the viewport doesn't grant click
   detection, those are two separate walls). This is why every "let me
   interact with what's inside the live board" idea has to route through
   either (a) our own canvas showing real synced/rendered data, or (b) a
   snapshot — never the live iframe directly.
3. **User pivoted to a much simpler, robust ask**: "auto-detect how many
   playbooks there are, list their names, a button called Edit Playbooks
   opens a panel with that list, clicking one opens that playbook's
   editor." **New `src/components/EditPlaybooksModal.tsx`** — reads
   `state.boxes` directly (already has count/labels from sync, no new
   detection needed), lists code/label/step-count per row, click → calls
   the same `onOpenEditor` logic already wired for the canvas (factored out
   as `openEditor(id)` in `page.tsx`, shared by both). New header button
   "Edit Playbooks" next to "Designer ID table". **This is the reliable
   click-to-edit path going forward** — no Figma geometry, no rendering, no
   cross-origin anything. Verified live end-to-end (list → click Emergency
   → correct editor opened with correct steps).
4. **User also wants to correlate a live test conversation with the real
   board for debugging** — "when the conversation isn't flowing, identify
   exactly which playbook and step we're at." Same insight applies: the app
   already has accurate structured data (no need to OCR a snapshot image).
   **New `src/components/FlowSnapshotModal.tsx`** — new header button "Flow
   Snapshot" — renders every playbook + step as readable text (with NAV
   targets resolved to real names, Designer IDs included), with the
   *current* `activeBoxId`/`activeStepIndex` marked inline (`◀ ACTIVE
   PLAYBOOK`, `◀ CURRENT POSITION`) plus a "Copy as text" button
   (`navigator.clipboard`). Verified live: correct box/step marked, NAV
   resolution correct, clipboard write confirmed.
5. **"Reset from Figma" moved to the right edge of the toolbar row**,
   same row as the other buttons but pinned to align with the canvas/portal
   window's right edge regardless of how many other buttons are present or
   how narrow the window is. Implementation note for future edits to this
   toolbar: it's now `<div class="flex flex-wrap items-start
   justify-between gap-2"><div class="flex flex-wrap ...">{all the other
   buttons + imageName + zoom controls}</div><button>Reset from
   Figma</button></div>` — a `justify-between` two-child split, **not** an
   `ml-auto` on Reset itself (tried that first; with this many buttons an
   `ml-auto` can still get pushed to a second line if the first row fills
   up before reaching it — the two-child split pins Reset to the
   *container's* right edge unconditionally, verified at both 1400px and
   narrower widths).
6. Everything in this update verified via `tsc`/`lint`/`build` (clean
   throughout) and live browser testing with synthetic/mocked data. As
   always: **nothing in today's session has been run against the user's
   real Figma board from my side** — I have no token. Every real-board bug
   found so far (the two spacing bugs, the geometry-position ask) was
   surfaced by the user testing directly and reporting back — expect the
   same pattern tomorrow, especially for item 1 above.

---

Read this file first when picking this session back up. `SESSION_HANDOFF.md`
in this same folder covers the earlier, separate "step-engine rebuild" night
and is still accurate background but is now historical — nothing in it
conflicts with this file, it's just an earlier layer. `HANDOFF.md` is the
original v2→v3 architecture handoff, also still-accurate background. The
full plan this session worked from (rationale + file-by-file plan) is at
`/Users/grahamplumb/.claude/plans/buzzing-meandering-dawn.md`.

## The goal, restated

The long-term target is a **self-serve toolchain for students**: each
student gets their own FigJam board, primes it with playbook content, runs a
plugin to auto-grow and populate the step tables, then connects that board
to this app (Gallery Guide Studio) to test the conversation live. Nothing in
this pipeline should require a Claude session or MCP access once it's built
— that constraint drove every architecture decision below.

## Where things stand

- **The FigJam plugin exists and is believed correct** (`figjam-plugin/` in
  this repo) but **has never been run for real** — it was hand-verified via
  `node --check` (syntax only) and by re-deriving its logic from the exact
  script this session ran manually, through Figma MCP, against a real
  board. It has not been imported into Figma's desktop app and clicked yet.
- **The app's sync/import side was rewritten** (`sync-figma/route.ts`,
  `PlaybookCanvas.tsx`, `types.ts`, plus new `ConfirmDialog.tsx` /
  `DesignerIdTableModal.tsx`) to consume the new board schema, merge
  non-destructively on resync, and render boxes even with no uploaded
  image. Verified via `tsc --noEmit` + `npm run lint` (both clean) and a
  live browser test using synthetic data injected into `localStorage` — but
  **never yet run end-to-end against a real Figma board with a real
  personal access token.**
- Nothing this session has been committed to git. `git status` will show a
  large set of modified/new files.
- The dev server was last left running for interactive testing; restart it
  with `npm run dev` (or via `.claude/launch.json`) to pick back up.

### Immediate next step when resuming

1. Get a Figma **personal access token** (Figma → Settings → Security →
   "Generate new token") and paste it into the app's "API keys" panel.
2. Prime one real FigJam board using the schema below (or reuse one of
   tonight's boards).
3. Try the plugin for real: Figma desktop app → the board → **Plugins →
   Development → Import plugin from manifest…** → select
   `figjam-plugin/manifest.json` → run it. This is the single biggest
   unverified piece of tonight's work.
4. In the app, click **Connect Figma file**, paste the board URL, click
   **Sync from Figma**, and confirm boxes appear, populate, and match the
   board.

---

## The board schema (what both the plugin and the app's sync route expect)

Established earlier tonight by hand-editing a real board through Figma MCP,
then reverse-engineered into both `figjam-plugin/code.js` and
`sync-figma/route.ts` as matching parsers. Every playbook on the board is a
cluster of nodes, related by position, not by grouping/frame membership:

- **Title** — a `TEXT` node reading exactly `PLAYBOOK <code>: <label>` (e.g.
  `PLAYBOOK 2A: EMERGENCY`). Regex: `/^PLAYBOOK\s+([0-9A-Za-z]+)\s*:\s*(.+)$/i`.
- **Instruction panel** — a `SHAPE_WITH_TEXT` node with freeform prose
  (the brief a student writes describing what this playbook should
  accomplish), positioned between the title and the table, roughly the same
  x as the title.
- **Table** — a `TABLE` node directly below the panel, fixed 7 columns:
  `STEP | BOT·USER·NAV | INSTRUCTION | VARIABLE | Send to TD | Save data to
  sheet | Designer ID`. Row 0 is the header. Starts life as a single seed
  row; both the plugin and manual editing grow it with `insertRow`.
- **Background box** — the largest empty-text `SHAPE_WITH_TEXT` whose
  top-left sits just above/left of the title and which is wider than the
  table. Resized taller whenever the table grows, so the whole card's
  backdrop keeps enclosing it.
- **Three buttons** — a row of `SHAPE_WITH_TEXT` nodes immediately below
  the table, left to right; the first must read exactly "OPEN PLAYBOOK
  EDITOR" (case-insensitive) — this is the one both parsers key off. The
  other two are visually present in the student's original mockup but their
  behavior was never defined (`SESSION_HANDOFF.md` flagged the same
  ambiguity) — still unbuilt, still waiting on the user.
- **Connectors** — real Figma `CONNECTOR` nodes between playbooks'
  background boxes, read by `sync-figma/route.ts` to prefill a box's
  `leadsTo` (used to prioritize the NAV-target picker in the editor with
  real neighbors first).
- **Stacking** — playbooks sharing a column (same x, increasing y) are
  spaced exactly **100px** apart, background-bottom to next-background-top.
  This exact number came from explicit user correction tonight (first tried
  16px — "too tight" — then just 10–20px — still "too tight" — landed on
  100px, "in future, end the process with a hundred pixels... do it now").

---

## Why a real plugin, not something inside the app

Three different Figma integration surfaces were evaluated this session,
each with a genuinely different write capability — this was verified
empirically, not assumed from docs:

1. **Figma classic REST API** (personal access token, what `sync-figma`
   already used) — **read-only structural access.** Confirmed via Figma's
   own `figma/rest-api-spec` GitHub repo (`api_types.ts`) that
   `TableNode`/`TableCellNode` with a `characters` string per cell are real
   documented response types, so pulling table content this way is sound.
   But this API cannot write/create nodes — no path to "auto-grow the
   table" from server code alone.
2. **Figma's remote MCP server** — genuinely *does* support writes
   ("Write to canvas," confirmed by directly testing it), which would have
   let this app become an MCP client and drive edits headlessly. **Ruled
   out**: third-party MCP clients are gated behind Figma's approved MCP
   Client Catalog + a waitlist — not available to a student-built Next.js
   app today.
3. **Figma Plugin API** — full read/write, the same API this Claude session
   used all night via its own MCP connection. The catch: **loading a
   plugin in dev mode ("Import plugin from manifest") only works in the
   Figma desktop app, not figma.com in a browser** (confirmed). This shapes
   the student onboarding requirement below — desktop app is mandatory,
   not optional.

Given that, "plugin first, then the app" was the user's explicit call: a
real FigJam plugin does the growing/populating, on the student's own
machine, with the student's own Anthropic key; the app then only ever needs
**read** access (the classic REST API) to pull finished content in.

### Figma seat type matters for anyone editing via Plugin API / MCP

Figma's seat tiers (Starter / Full / Dev / Collab) gate Plugin API write
access to **Full seats only** — hit directly tonight as a real error
("To use MCP tools that make edits, you'll need a Full seat") on a
Pro-team board, root-caused to being authenticated as the wrong Google
account (one with only View/Limited access on that team) rather than the
admin account. This applies to the plugin too: a student on a Starter/Dev/
Collab seat on a given team will not be able to run the plugin's writes
against a board owned by that team. Worth checking a student's seat type
before debugging "the plugin didn't do anything."

---

## The FigJam plugin — `figjam-plugin/`

Plain JS, no build step, three files:

- **`manifest.json`** — `editorType: ["figjam"]`, `main: "code.js"`,
  `ui: "ui.html"`, `documentAccess: "dynamic-page"`, and
  `networkAccess.allowedDomains: ["https://api.anthropic.com"]` (the plugin
  calls Anthropic directly, never this app's server — see rationale below).
- **`code.js`** — the main sandbox script (Plugin API access, no `fetch`).
  `findPlaybooks()` scans the page for the title/table/panel/background/
  button cluster described above by geometry. `run()`: for each playbook
  whose table is still at its 1-row seed state (`tableHasRealContent`
  checks cell (1,1)) and has both an instruction panel and an API key, asks
  the UI to generate steps, then `populateTable()` writes them in — cell
  edits always go through the canonical recipe (`getStyledTextSegments`
  → `loadFontAsync` → mutate `.characters`) since Figma throws if you write
  text with an unloaded font. After each playbook, its own background/
  buttons are shifted/resized by exactly its table's height delta; a second
  pass then re-normalizes every stacked column to the fixed 100px gap.
  Settings persistence and the generation request/response bridge use
  `figma.ui.postMessage` / `figma.ui.onmessage` (`pendingGenerations` is a
  `Map` keyed by table node id, since generation is async and multiple
  playbooks can be in flight).
- **`ui.html`** — the settings panel (designer initials + Anthropic API
  key, saved via `figma.clientStorage` so a student only enters them once)
  plus the actual `fetch()` call to `https://api.anthropic.com/v1/messages`
  (the main sandbox can't do network calls; the UI iframe can). Carries its
  own copy of the step-generation system prompt and tool schema — a
  deliberate, acknowledged duplication of `generate-playbooks/route.ts`'s
  prompt, accepted because the plugin must work standalone, without this
  Next.js app being deployed or even running anywhere. A student who only
  ever uses the plugin, never the app, still gets full functionality.

`figjam-plugin/README.md` has the condensed install/usage version of the
next section — keep both in sync if either changes.

### Installing and running the plugin (draft student instructions)

1. **Use the Figma desktop app**, not figma.com in a browser — dev-mode
   plugin import doesn't work in-browser (confirmed this session).
2. Open the FigJam board.
3. Right-click the canvas → **Plugins → Development → Import plugin from
   manifest…** → select `figjam-plugin/manifest.json` from this repo.
4. Run it: **Plugins → Development → Gallery Guide Studio — Playbook
   Builder**.
5. First run: paste an Anthropic API key (and optionally your initials,
   e.g. `GP`) into the panel — both are remembered locally for next time.
6. Click **Grow & populate**. Tables that already have real content are
   left untouched; only playbooks still at their 1-row seed state get
   generated and grown. Progress logs per playbook in the panel.

**Not yet written**: the fuller onboarding doc the user explicitly asked
for ("I'm going to need a set of instructions that help students through
this process, including the OAuth/MCP connection") — this section is the
seed of it but doesn't yet cover account setup, the app side, or
troubleshooting. Still pending (see Open Items below).

---

## Generate Steps — triggering the plugin from the app (added later this session)

The user asked for a button in the app itself, **Generate Steps**, that
tells the connected FigJam board to grow/populate without switching over to
Figma and clicking the plugin's own button. Figma has no API to wake up a
plugin that isn't already running, so this only works with the plugin panel
open in Figma at the same time as the app — confirmed as an acceptable
constraint with the user directly (see the approved plan file for the full
three-question exchange). Built as a small **job queue**:

- App: **Generate Steps** button (toolbar, right after "Connect Figma
  file") → `POST /api/figma-jobs` queues a job → polls
  `GET /api/figma-jobs/{id}` every 2s (verified via a real browser test to
  land almost exactly on 2000ms, not a busy-loop) with a 90s timeout →
  on `done`, automatically calls the existing `syncFromFigma()` merge.
- Plugin (`ui.html`, while its panel is open, "Listen for Generate Steps
  requests" checkbox on by default): polls
  `GET /api/figma-jobs?claim=<fileKey>` every 4s. On claiming a job, it
  triggers `code.js`'s existing `run()` — completely unchanged — via the
  same message path the manual button already uses, and forwards `run()`'s
  own progress/done messages back to the job so the app sees live status.
- New files: `src/lib/figmaJobStore.ts` (in-memory queue — lives only in
  the Next.js dev-server process's memory, lost on restart, an accepted
  tradeoff), `src/app/api/figma-jobs/route.ts` (create + claim),
  `src/app/api/figma-jobs/[id]/route.ts` (status + progress updates, with
  CORS headers since the plugin's UI iframe is a different origin than
  `localhost:3000`). Shared `parseFigmaUrl` pulled into `src/lib/figmaUrl.ts`
  so `sync-figma/route.ts` and the new button both use the one
  implementation.

**Real constraint worth flagging loudly**: the plugin's `manifest.json`
`networkAccess.allowedDomains` is a static allowlist read at plugin-import
time — it can't be pointed at a dynamically-entered port. This feature
therefore hard-requires the app to run on `npm run dev`'s **default port
3000, unchanged**. Verified this is a real, not theoretical, risk on this
exact machine: port 3000 was found occupied by a 4-day-old stray
`next-server` process serving the *old v1* copy of this project
(`Immersiive Lab UI Design_v1`, PID 56608 at the time), left running since
the previous Friday. That process needs to be stopped (`lsof -i :3000`,
then `kill <pid>`) before this feature will work for real — otherwise the
plugin's requests silently go to the wrong app entirely. Worth checking for
before the first live test, and worth the same check on a student's machine
if this feature mysteriously "does nothing."

**Verified this session**: full job-queue mechanics via curl (atomic single
claim, fileKey scoping, status/log updates, CORS preflight, 404 handling —
all correct) and a live browser pass clicking the real **Generate Steps**
button in the running app (correct button state transitions
Idle→Queued→timeout-eligible, correct 2s poll cadence measured precisely
via a `fetch`-wrapping console probe). **Not yet verified**: the actual
plugin-side half (`ui.html`'s polling/claiming/forwarding, `code.js`'s new
`file-info`/`file-info-request` messages) — the plugin itself has still
never been run inside real Figma at all (same gap noted above), so neither
the original "Grow & populate" button nor this new remote-trigger path has
had a real end-to-end pass yet. `npx tsc --noEmit`, `npm run lint`, and
`npm run build` all clean after this addition.

---

## App changes this session

**`src/lib/types.ts`** — `PlaybookBox` gained:
- `code: string` — auto-parsed only (`"1"`, `"2A"`, ...), drives the
  Designer ID and editor header instead of array index. Never hand-edited.
- `instructionPrompt: string` — the freeform brief, editable in the editor
  modal, primary input to "Regenerate steps."
- `figmaSourceId?: string` — the Figma TABLE node id from the last sync;
  primary merge-match key.
- `lastSyncedSnapshot?: { instructionPrompt, steps }` — last-synced content,
  used only to diff on the next resync, never rendered.

**`src/app/api/sync-figma/route.ts`** — full rewrite, same REST
auth/fetch scaffolding as before. Walks the file's node tree once
(`collectNodes`), finds title/table/panel/background by the geometry rules
above, groups a table's `TABLE_CELL` children into rows (`groupTableRows` —
prefers explicit `rowIndex`/`columnIndex` fields if the API returns them,
otherwise falls back to natural append order, which is row-major for every
table this project builds), parses `BOT`/`USER`/`NAV` steps, resolves NAV
targets by matching "playbook \<code\>" mentions in instruction text against
known codes (longest code first so "2A" isn't shadowed by "2"), and derives
`leadsTo` from real `CONNECTOR` nodes between background boxes. New boxes
that don't match anything on the client are placed in a **4-column grid**
(`GRID_COLUMNS=4, GRID_CELL_W=20, GRID_CELL_H=10, GRID_GAP_X=3,
GRID_GAP_Y=4, GRID_MARGIN=3`, all in the app's 0–100% canvas units) instead
of one fixed spot — this was a same-session bug fix, see below.

> **Known unverified detail, flagged in the code**: the exact field names
> Figma's REST API uses for a table cell's row/column position were never
> confirmed against a live API response (no token was available while
> writing this). The sequential-chunking fallback should be correct
> regardless (tables are always built row-major by every tool in this
> project), but if a real sync ever groups cells oddly, check
> `groupTableRows` first.

**`src/components/PlaybookCanvas.tsx`** — most heavily changed file.
Toolbar, left to right, matching expected usage order per the user's
explicit request: **Connect Figma file → Generate Steps → Upload image →
Auto-detect blue buttons → Sync from Figma → Reset from Figma → Show
live/diagram toggle → + Add playbook box → Show connections → Clear image &
boxes.** (Generate Steps added later this session — see its own section
above.) New pieces:
- `connectFigma` / `fetchFigmaBoxes` / `syncFromFigma` / `resetFromFigma`.
  **Sync** = non-destructive merge (`mergeSyncedBoxes`/`snapshotsMatch`):
  match by `figmaSourceId`, else `code`; if the box's current content still
  equals `lastSyncedSnapshot`, overwrite from the fresh sync and update the
  snapshot; if it differs (edited in-app since), skip it and note how many
  were skipped; unmatched boxes are added as new. **Reset** = the old full
  destructive replace, now gated behind a real `ConfirmDialog` (danger-red
  confirm + neutral cancel) instead of a native `confirm()`.
- `toEmbedUrl` + a live/diagram view toggle — renders the actual FigJam
  board as a live, interactive `iframe` (Figma Embed Kit 2.0:
  `https://embed.figma.com/board/{fileKey}/{fileName}?embed-host=share`,
  confirmed genuinely live — cursor presence, full toolbar — via a direct
  browser test) as a *reference* alongside the app's own editor, per the
  user's explicit choice ("Embed as reference, editor stays primary") over
  making it the primary editing surface.
- Each box's on-canvas chip now has a visible blue **"Open playbook
  editor"** button matching the original mockup, alongside drag/rename/
  delete.
- `VIRTUAL_CANVAS = { width: 1600, height: 1000 }` and related rendering
  changes — see the bug writeup below; this is what makes boxes visible
  with no uploaded image at all.

**`src/components/PlaybookEditorModal.tsx`** — row count now
`Math.max(steps.length + 1, MIN_ROWS=3)`, uncapped (was a fixed 10-row
table) — needed since the user expects dialogues to reach ~20–25 boxes
total, some tables likely exceeding 10 steps. New `instructionPrompt`
textarea under the header. "Generate prompt" relabeled "Regenerate steps."
Header and Designer ID use `box.code` (falling back to `boxIndex + 1` if a
box has never synced and so has no code yet) instead of raw array index.

**New `ConfirmDialog.tsx`** — generic `{title, message, confirmLabel,
onConfirm, onCancel}` modal; only consumer today is Reset-from-Figma.

**New `DesignerIdTableModal.tsx`** — read-only, opened via a header button.
Flattens every box's steps into one live-computed table (Designer ID /
Playbook / Step / Option / Instruction / Variable) — explicitly a *view
only* per the user's decision ("just give me a live view for now... we can
figure out how that is saved as data later"); export-to-file is deliberately
out of scope for this pass.

**`src/lib/styles.ts`** — added `buttonDanger` (`#b91c1c` red), called out
in its own comment as "the one deliberate break from the otherwise-strict
monochrome system," reserved only for destructive actions so red stays a
reliable, singular danger signal.

**`src/app/api/generate-playbooks/route.ts`** — `TargetBox` gained
`instructionPrompt?: string`; the prompt now frames a target's own brief as
"the primary source of intent" rather than inferring purely from context.

**`src/app/page.tsx`** — wired `DesignerIdTableModal` + its open state,
`onChangeInstructionPrompt`, `instructionPrompt` threaded into both the
bulk and single-box generation calls' payloads, new header button.

---

## Bug found and fixed this session: "auto-detect blue buttons" appeared broken

User report: *"The auto detect blue buttons feature is not working...
Clicking this any one of the blue buttons should open up a playbook editor
window."* Initial screenshot showed the Auto-detect button greyed out.
Investigation with a real project PNG confirmed **detection itself worked
perfectly** (6 boxes found, correctly positioned; only labels fell back to
"Untitled box N" because no Anthropic key was set in that test pass —
expected, not a bug). The user then clarified the actual workflow being
used: *"We are not detecting an image. We have a portal on the FigJam file.
We still need to detect the blue buttons."* — i.e. no image is ever
uploaded in their real flow; they connect the live Figma embed and use
**Sync from Figma** instead.

That reframed it as two real bugs, both now fixed:

1. **`sync-figma/route.ts` gave every new box the same hardcoded position**
   (`x:35, y:35, width:30, height:12`) — any synced box with no existing
   match landed exactly on top of the last one. Fixed with the 4-column
   grid placement described above.
2. **`PlaybookCanvas.tsx` only rendered boxes at all when `imageDataUrl`
   was truthy** — a portal/embed-only workflow with no uploaded image had
   correct box data in state but nowhere to draw it. Fixed by adding
   `VIRTUAL_CANVAS` as a fallback reference frame for `fitToFrame`, gating
   the empty-state render and the wheel-zoom/drag handlers on
   `boxes.length > 0` as well as `imageDataUrl`, giving the canvas wrapper
   explicit virtual dimensions when there's no image, adding an explanatory
   "No diagram image — boxes shown on a blank canvas" label, and removing
   the image-required disable on "+ Add playbook box."

Verified via `npx tsc --noEmit` (clean), `npm run lint` (clean), and a live
browser pass: injected 3 synthetic boxes into `localStorage` with
`imageDataUrl: null`, confirmed all three render spread out with no
overlap, remain draggable, and clicking one opens the editor correctly.
**Not yet verified against a real Figma sync** — only synthetic data so
far; see "Immediate next step" above.

---

## Explicit decisions locked in this session (don't re-litigate)

- Canvas stays image-or-blank + hotspot based; sync only ever updates box
  *content*, never repositions an existing matched box from Figma geometry.
- Box `code` is auto-parsed only, never hand-edited in the app.
- Designer ID table is a live computed view for now; persistence/export is
  explicitly future scope.
- Resync = non-destructive snapshot-diff merge. Reset = destructive, red,
  behind a real confirm dialog.
- Toolbar button order is deliberately left-to-right in expected-usage
  order, not alphabetical or grouped by type.
- Scale target: design for ~20–25 boxes per dialogue (this session's 6-box
  board was described as "roughly a quarter" of a typical one).
- The plugin calls Anthropic directly with the student's own key; it does
  not depend on this Next.js app being deployed or reachable.
- Live Figma embed is a **reference** panel; the app's own modal editor
  stays the primary place edits happen (explicit choice over making the
  embed itself the primary editing surface).

## Open items / not yet done

**(Stale entries from earlier tonight removed — port 3000 was freed and
confirmed working; `Sync from Figma` and `Reset from Figma` have both since
been run for real by the user against their actual board, multiple times,
which is how the spacing/geometry bugs above were actually found and
fixed.)**

- **Figure out why "Detect Blue Buttons" doesn't work for the user** — see
  Update #2 item 1 above. This is the top open bug. Needs a real
  screenshot/error from the user against their actual board before
  guessing further; my own testing only used a mocked API response, which
  clearly wasn't enough to catch the real issue. **Not currently the
  recommended path anyway** — "Edit Playbooks" (item 3) is simpler, fully
  working, and doesn't depend on Figma image rendering at all. Worth asking
  the user tomorrow whether they still want Detect Blue Buttons fixed, or
  whether Edit Playbooks fully replaces that need.
- **The FigJam plugin itself (`figjam-plugin/`) has still never been run
  inside real Figma** — this has been true all session and remains the
  single biggest untested piece of the whole toolchain. Neither the manual
  "Grow & populate" button nor the newer Generate-Steps-triggered polling
  path has ever executed for real.
- **Write the full student-facing setup doc** (API keys, priming a board
  with the schema, installing the plugin, running it, then connecting the
  app) — still not started as its own deliverable, still explicitly
  requested earlier this session.
- **Verify sharing FigJam files to students' `.edu` accounts actually
  works** — never verified; recommended testing with 2–3 real students
  first.
- The two unlabeled buttons next to "Open playbook editor" in the original
  mockup are still undefined — user said "not decided yet" twice now.
- "Send to TD" and "Save data to sheet" table columns remain inert
  checkboxes only — user has twice said they'll explain the intended
  wiring later.
- Not yet asked, but worth raising: now that Edit Playbooks + Flow Snapshot
  give reliable non-visual ways to navigate/debug, does the user still want
  to keep investing in "Show live Figma board" / "Detect Blue Buttons" as
  primary interaction surfaces, or are those now secondary/reference-only?
  Their own words earlier tonight ("let's try a different approach") hint
  at the latter but this hasn't been asked directly.
- Nothing from tonight is committed to git yet.
