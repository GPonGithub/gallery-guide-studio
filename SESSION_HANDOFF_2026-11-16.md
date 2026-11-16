# Session handoff — 2026-11-16 (covers 2026-11-15 evening → 11-16)

Read this first. It replaces `SESSION_HANDOFF_2026-11-15.md` as the starting point (that file still has the full detail of §1–13; this one summarises it and adds today). The full project write-up is **`gallery-guide-studio/HANDOFF_V10.md`** (also as PDF) — read it for how everything works.

Opening line for the next conversation:

> Read `Claude/SESSION_HANDOFF_2026-11-16.md`, then continue. Graham's app work is on branch v10 in `Claude/gallery-guide-studio` (studio at http://localhost:3000/agent; don't open it in your own browser). A student continues separately as v11.

---

## 1. Where everything stands

| Thing | State |
|---|---|
| App repo `gallery-guide-studio`, branch **v10** | Last commit **8fc76cd**, pushed. Nothing uncommitted except `Scene 1 - Welcome to the Immersive Lab.md` (untracked, not ours — leave it). The folder also has an extra git remote named `v11` (added by someone else on 11-16; harmless — don't push to it from here). |
| Vercel | Preview builds on every v10 push. Branch link: https://gallery-guide-studio-git-v10-gpongithubs-projects.vercel.app/agent (Vercel sign-in). Latest: `gh api repos/GPonGithub/gallery-guide-studio/deployments`. |
| **Version 11 (student)** | Separate repo **https://github.com/GPonGithub/gallery-guide-studio-v11** (public, default branch `v11` = v10 at ea7a8d3 + 582d7ee setup docs). Student **jsaputraixd** is a collaborator (write). Start-here PDF: https://github.com/GPonGithub/gallery-guide-studio-v11/raw/v11/HANDOFF_V10.pdf. v11 does **not** have the 11-16 receiver fixes (8fc76cd) — they'd need cherry-picking if the student wants them. |
| Local copies | v10: `Claude/gallery-guide-studio` → dev server on **:3000** (Terminal tab "v10 studio 3000"). v11: `Claude/gallery-guide-studio-v11` (cloned, `npm install` done) → dev server on **:3001** (tab "v11 studio 3001"), still running. Different ports = separate browser storage. |
| **TouchDesigner** | Saved **r1.54**: `Fall 2026 Grahams Work/TouchDesigner_Graham_Fall_2026/F2026_StudioMap_r1.54.toe` (that's the real location — not `~/CCA-TouchDesigner`). Receiver on ws/http `localhost:9980`. |
| MQTT broker | `pi02zigbee.local:1883` (only `10.42.0.1` answers from this Mac). |
| Google Sheet | Not edited. Team AE uses its own sheet; Graham's is separate. |

---

## 2. Standing rules (unchanged — keep them)

- Graham's work: **v10 only** in `gallery-guide-studio`; v8 is the frozen safe copy. Check `git branch --show-current` before editing (on 11-16 it had been switched to a `v11` branch by something else — switch back to v10 if so; working tree was clean).
- **Never open the studio in my own browser** (a fresh browser restores Team ED's backup; connecting to TouchDesigner sends `clear`). Verify with `tsc`, `eslint`, curl, scripts, TD diagnostics; reading Graham's Chrome window read-only via computer-use is fine when he asks.
- **Commit and push only when asked.** Graham's API keys live only in his browser (AI routes can't be exercised from the shell).
- **Never overwrite a media file under the same name** without asking; keep originals in an `Originals before …` folder (the Media Library skips these).
- Every wall image is a flat, square-on front elevation. Don't reword sheet row 8 actions ("When asked…").
- Every exported JSON carries its team; imports only into the same team.
- Don't change macOS settings. Paid services only on request.
- Graham dictates; messages get cut off — say how I read them or ask. He likes short plain reports and clickable choices.
- **Code edits to non-component modules reload the studio page** (Next HMR) → Chrome then forgets the media-folder permission until a click (handled since b535275, but expect a re-allow).

---

## 3. What was done 11-15 evening → 11-16 (all committed)

| Commit | What |
|---|---|
| 0e59d65 | Scene label on zone 1 · area 2 (mic on/off, scene number, title); chatbot bar volume 0–400% + voice placement in Spatialized Audio; Adding Immersive Media tour extended (20 steps); TD finds student media in `~/Documents/2026 Fall Student Work/<Team>/<folder>`; library skips `Originals before …` |
| b535275 | Drawing keeps marker pictures/chatbots: after a reload the first press on drawing/timeline re-asks folder permission; failed pictures reported on the timeline; `stopSceneMedia` (Refresh This Scene, clear conversation, opening a scene) replays the marker's stage 400 ms later; no empty media list sent before a scene opens |
| 90c62de, ea7a8d3 | `HANDOFF_V10.md` (+ PDF): Part A = how to continue as v11; Part B = everything in v10. `touchdesigner/lab-mac-scripts/` (48 TD scripts from the lab Mac) and `touchdesigner/PROJECTORS_5_6_TOUCHDESIGNER.md` added to the repo |
| 8fc76cd | Receiver: a **team folder chosen directly** as the media folder is found (`STUDENT_WORK/<folder>/<path>`); **any message restarts a stopped timeline**; `update_receiver.py` reads UTF-8; `wall_chain_diag.py` |

Also (not code): Team AE's 11 fake `.png` files (really WebP/JPEG) in `2026 Fall Student Work/Team AE/Waiting Room_01` were converted to real PNGs with Graham's OK; originals in `Waiting Room_01/Originals before PNG`.

---

## 4. The 11-16 problem: media dragged onto the drawing not on the projectors

Two separate causes, both fixed and seen working (Team ED's `Scene Images/Bedroom/Area_02.png` on projector 1, section 2):

1. **Team ED chose its whole team folder** (`2026 Fall Student Work/Team ED`) as the media folder, so paths are `Scene Images/…`; TD looked only in `Team ED/<scene folder>/…` → "file missing", "0 of 33 files found". Receiver now also tries `2026 Fall Student Work/<folder>/<path>`. All 30 Team ED images are genuine PNG/JPEG.
2. **TD's timeline was stopped** (frame 220). Kantan Mapper only redraws while it plays, so the four wall projectors were black for everything while areas had their pictures (projector 5 still worked — it isn't in the blend). Restarted; the receiver now restarts it on any non-voice message.

**Graham still needs to:** in the Team ED studio, section 4 → Disconnect, Connect (the walls currently show my test pictures, e.g. `hosp-section-08-wall.png` in area 10).

### How to diagnose this kind of thing quickly
1. `curl -s -X POST -H 'Content-Type: application/json' -d '{"type":"hello"}' http://localhost:9980/` — TD alive? (reply `ready`, project name).
2. In TD's Textport run `area10_diag.py` (edit its `for a in (…)` line) → `area10_diag.txt`: message log (what arrived, "file missing" / "shown"), each area's movie file and size (256×256 = file TD couldn't read).
3. Run `wall_chain_diag.py` → `wall_chain_diag.txt`: timeline playing?, brightness of area → area_labels → projectorBlend → projector_out (black blend with bright areas = Kantan/timeline).
4. See the projector outputs without the room: computer-use `app_screenshot` of TD's projector windows (window ids from `app_list_windows`; the 1920-wide ones at x = 1920…7680 are the walls, the 2560 one projector 6, the one at x=-4480 projector 5).
5. Find a student's file on disk: `mdfind -name "<file>"`; check formats with `file *.png`.

### Typing in TD's Textport (computer-use)
Full-screen control is needed (background typing doesn't reach it). First `osascript -e 'tell application "TouchDesigner" to activate'`, screenshot, click **on** the `python >>>` line (the window moves between sessions; a click just below the line sends the typing nowhere), End, type, Return. Update + save in one line:
```python
exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/update_receiver.py').read()); project.save(); print('saved', project.name)
```
Keep `build_immersive_lab.py` plain ASCII. After editing it, copy it to `gallery-guide-studio/public/touchdesigner/` (keep that copy's own `MEDIA_FOLDER` line) and `gallery-guide-studio/touchdesigner/lab-mac-scripts/`.

---

## 5. Answers given (so they aren't re-worked)

- **Export file names**: `chatbot-designer-project-team-ED-<date>.json`, `Chatbot Designer scenes team-AE <date>.json`, `team-ED - <scene>.goal-agent.json`, `show team-AE.json`, backups `.local-backup/team-<name>.json` (Graham's copy uses `Graham`).
- **Complete restart** (Scenes window) clears only the current team's browser data (scenes, Design Process, the patient's saved info); keys, voices, patients, media folder/library/connections stay. Exception: with the Apps Script set, it empties **row 7 in every scene column of that team's sheet** — shared if two teams link the same sheet.
- **Student media folders** live in `~/Documents/2026 Fall Student Work/Team AE|Team ED/`; either the team folder itself or a scene folder inside it works now.

---

## 6. Untested / still open

- Seen working: scene label on P5; Team AE picture (P4) and Team ED picture (P1) on the walls; chatbot reaching TD area 6.
- Type-checked only: chatbot voice placement/volume in a call; the new tour steps; scene label changing live; permission re-ask on first click; drawing refill after Refresh This Scene; W4-01 buttons, mic-off-for-music and dual mics in a real call (from d57b14b).
- Open: move the projector-screen auto rule into the receiver's `heal_screens`; push-to-talk doesn't label the speaker; dual mics drop overlapping speech as music; the sheet's Apps Script needs updating for the media list; studio could warn about media files whose content doesn't match their ending; the TD timeline stopping — cause unknown (now self-heals on the next message).
- v11 lacks 8fc76cd (receiver fixes) — the receiver is shared on the lab Mac anyway (TD r1.54 has them).
