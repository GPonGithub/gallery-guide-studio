# Playbook Builder (FigJam plugin)

Grows a FigJam board's playbook step tables from their instruction panels,
and keeps stacked playbooks spaced exactly 100px apart. This is the same
process used to build the reference board earlier, now available as a
plugin instead of requiring an MCP-connected session.

## What it expects on the board

For each playbook, three things, matched by position:
- A **title** text node reading `PLAYBOOK <code>: <label>` (e.g.
  `PLAYBOOK 2A: EMERGENCY`).
- An **instruction panel** — a shape with the freeform brief for that
  playbook, positioned between the title and the table.
- A **table** with the standard columns (STEP / BOT·USER·NAV / INSTRUCTION
  / VARIABLE / Send to TD / Save data to sheet / Designer ID), starting at
  its 1-row seed state.
- A background box and three buttons directly below the table (the
  "OPEN PLAYBOOK EDITOR" row) — used to resize/reposition as the table
  grows. If these aren't found for a given playbook, its table still gets
  populated, just without the resize/reposition step.

Playbooks in the same horizontal position (a column) are treated as
stacked, top to bottom, and re-spaced to a 100px gap after processing.

## Installing (desktop app only — dev-mode plugins don't load in the browser)

1. Open the Figma **desktop app** (not figma.com in a browser) and open
   the FigJam board.
2. Right-click the canvas → **Plugins → Development → Import plugin from
   manifest…**
3. Select `manifest.json` from this folder.
4. Run it from **Plugins → Development → Gallery Guide Studio — Playbook
   Builder**.

## Using it

Enter your Anthropic API key (and optional designer initials) once — both
are remembered locally by the plugin for next time, never sent anywhere but
directly to Anthropic. Click **Grow & populate**. Tables that already have
real content are left alone; only playbooks still at their 1-row seed get
generated and grown.

## Triggering it from the app instead

With **"Listen for Generate Steps requests from the app"** checked (on by
default), the plugin also polls the Gallery Guide Studio app for a remote
"run now" signal every few seconds, so the app's own **Generate Steps**
button can trigger the exact same run without switching over to Figma.
Requirements for this to work:

- The app must be running locally on its default port — `npm run dev`,
  **port 3000, unchanged**. The plugin can only reach the exact addresses
  listed in `manifest.json`'s `networkAccess`, which is a fixed allowlist
  checked when the plugin is imported — it can't be pointed at a different
  port at runtime. If something else on your machine is already using port
  3000, stop it first (`lsof -i :3000` to find what, on macOS).
- This plugin panel must be open and running in Figma **at the same time**
  as the app — Figma has no way to wake up a plugin that isn't already
  running, so the button in the app has nothing to reach if this panel is
  closed. Clicking the app's button with the panel closed will time out
  after ~90 seconds with a message saying so.
- Both the app and Figma desktop need to be on the same machine — the
  plugin talks to `http://localhost:3000` directly, not to anything
  hosted.

Uncheck the box to go back to only running via the button in this panel.
