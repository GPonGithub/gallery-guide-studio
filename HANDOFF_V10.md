# Chatbot Designer — v10 handoff, and how to continue as v11

This document is for whoever continues the project as **version 11**, in their own Claude account. Part A is everything you need to get going; Part B is what v10 contains and how it works.

- Repository: **https://github.com/GPonGithub/gallery-guide-studio** (public), branch **v10**, latest commit when this was written: **90c62de** (2026-11-15). v8 is a frozen safe copy; v9 is set aside.
- Owner: Graham Plumb (CCA, Fall 2026 Immersive Lab / Connected Hospital project).
- Studio on the Immersive Lab Mac: **http://localhost:3000/agent** (not the bare root — that's the older Conversation Generator).
- Vercel preview of v10 (needs a sign-in to Graham's Vercel team): https://gallery-guide-studio-git-v10-gpongithubs-projects.vercel.app/agent
- TouchDesigner project on the lab Mac: `~/CCA-TouchDesigner/immersive_room_f2026/F2026_StudioMap_r1.52.toe`.

---

# Part A — Continuing the project as v11

## A1. What this project is

**Chatbot Designer** is a Next.js web app ("the studio") that students use to design voice chatbots for scenes in a hospital role-play, and to run those scenes in CCA's **Immersive Lab** (room 140): a room with six projectors and four speakers, driven by **TouchDesigner**. A scene is written in a shared **Google Sheet** (one column per scene); the studio turns it into a staged conversation, speaks it with **ElevenLabs** voices, listens with Chrome's speech recognition, and puts pictures, video and sound into the room as the conversation moves through its stages. Zigbee buttons in the room reach the studio over **MQTT**.

## A2. What you need (accounts and access)

| You need | Why | How |
|---|---|---|
| A GitHub account with **write access** to `GPonGithub/gallery-guide-studio` | To push v11 | Ask Graham to add you as a collaborator — or fork the repo and work in your fork |
| An **Anthropic API key** | The chatbot's replies, scene generation, the media judge | console.anthropic.com. Typed into the studio's **Keys** panel (kept only in that browser) |
| An **ElevenLabs API key** and a **voice ID** | The chatbot's voice | elevenlabs.io. Also typed into **Keys** |
| The scenes **Google Sheet** link (or your own copy) | Scenes are imported from it | Ask Graham. The sheet must be shared "anyone with the link"; writing back (row 7 saved info, the media list) needs the Apps Script in `src/lib/agent/sheetScript.ts` deployed from the sheet (Extensions → Apps Script → Deploy → web app) |
| **Chrome** (or Edge) | Speech recognition, folder access, Web Audio | Safari and Firefox aren't supported |
| Access to the **Immersive Lab Mac** (user `ixdstudio`) | TouchDesigner, the projectors, the speakers, the MQTT broker | Only needed for room features; the studio itself runs anywhere |
| Optional: **Vercel** access | Hosted previews for students | Ask Graham to add you to `gpongithubs-projects`, or import the repo into your own Vercel account (see `HOSTING.md`) |

No server-side API keys are required: every key is typed into the studio by the person using it. Optional server environment variables: `MQTT_BROKER_URL`, `MQTT_BROKER_ADDRESSES` (MQTT), `FFMPEG_PATH`, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) for the FigJam plugin on a hosted copy.

## A3. Set up on your computer

1. Install **Node.js** (v20 or later; the lab Mac runs v26) and **git**. On a Mac: `brew install node git`.
2. Get the code and start v11 from v10:
   ```bash
   git clone https://github.com/GPonGithub/gallery-guide-studio.git
   ```
   ```bash
   cd gallery-guide-studio && git checkout v10 && git switch -c v11
   ```
3. Install and run:
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```
   `npm install` also applies the patches in `patches/` (patch-package) and brings `ffmpeg-static` (video conversion and thumbnails).
4. Open **http://localhost:3000/agent** in Chrome. Pick a team (Team ED / Team AE / Graham — each is a separate copy of the app in the browser), open **Keys** (top right) and enter the Anthropic key, ElevenLabs key and voice ID.
5. Design Process → **1 · Generate scenes from Google Sheet**: paste the sheet link. Adding Immersive Media → **1 · Media folder**: choose the scene's media folder. **Onboard Me** beside each section walks through the rest.
6. Push v11 when you're ready: `git push -u origin v11`. Vercel (if connected) builds a preview of every push.

## A4. Working on it with Claude Code (your own account)

- Open the repo folder in Claude Code (desktop app Code tab, or `claude` in a terminal inside `gallery-guide-studio`).
- `CLAUDE.md` points to `AGENTS.md`, which says: **this Next.js (16.3.5) has breaking changes — read the guide in `node_modules/next/dist/docs/` before writing Next code.** Claude reads this automatically.
- A good first message: *"Read HANDOFF_V10.md, then check `git branch --show-current` is v11. We're continuing the project as v11."*
- `.claude/launch.json` defines the dev server (`npm run dev`, port 3000) for Claude's preview tools.
- Check every change with `npx tsc --noEmit -p .` and `npx eslint <files>` before committing.

## A5. House rules (carried over from v10 — keep them)

1. **Work on your own branch (v11).** Never commit to v8 (the safe copy) or rewrite v10.
2. **Commit and push only when asked**, with clear messages.
3. **On the lab Mac, don't open the studio in a fresh browser to test it.** A fresh browser restores Team ED's backup, and connecting to TouchDesigner sends `clear` (blanks the room). Test with type-check, lint, curl and small scripts; say what wasn't seen.
4. **Never quit Chrome on the lab Mac.** Its profile is ephemeral (school-managed): quitting wipes every key, scene and media connection. `.local-backup/` (lab Mac only, not in git) holds automatic backups per team.
5. **Never overwrite a media file under the same name** without asking. Keep originals in an `Originals before …` folder (the library skips these).
6. **Every wall image is a flat, square-on front elevation** (nothing drawn at an angle, no floor).
7. **Don't reword a sheet row 8 media action**: the media connections store the exact action text, so a reworded line disconnects its timeline bar. Row 8 actions start "When asked…".
8. **Every exported JSON carries its team** and imports only into the same team (`src/lib/team.ts`). Keep it that way for any new export.
9. **Don't change macOS settings** (input device, displays) from code; fixes go into the app or TouchDesigner.
10. Graham dictates his messages, which are often cut off mid-sentence: say how you read a cut-off message, or ask. He prefers short plain reports and clickable choices.
11. **Paid services** (image generation, Storyblocks downloads) only on a clear request.

## A6. How the app is built

- **Next.js 16 App Router**, React 19, TypeScript. Almost everything runs in the browser; server routes call Anthropic / ElevenLabs with the key sent from the browser.
- **Pages:** `src/app/agent/page.tsx` (the studio — large; hooks must stay above its early return, around line 930), `src/app/ai-character/` (the orb page TouchDesigner shows for an AI character), `src/app/phone/`.
- **Storage:** all in the browser, per team — localStorage (team ED unprefixed; others `team-<name>:`) and IndexedDB (`goal-agent-studio[-<team>]`): scenes, keys, media libraries, folder handles, timeline connections. `/api/local-backup` mirrors each team to `.local-backup/team-<name>.json` on the computer running the server.
- **Main API routes:** `/api/agent/turn` (a conversation turn), `/api/agent/generate` (scene design from the sheet), `/api/media/moments` (the media judge: does the caller's sentence trigger a media action), `/api/agent/people` (dual-mic names), `/api/sheets/scenes|media|saved` (Google Sheet), `/api/tts*` (ElevenLabs), `/api/media/convert|thumbnail|ffmpeg` (ffmpeg), `/api/mqtt` (room buttons), `/api/local-backup`, `/api/recording`.
- **The Google Sheet**: column A labels, one column per scene. Rows: 1 number, 2 name, 3 describe this conversation, 4 knowledge, 5 information saved, 6 cannot use, 7 saved list (written back), 8 media actions (one per line), 9 media, 10 persona, 11 people in this scene (`Name: role`). Quick read: `https://docs.google.com/spreadsheets/d/<id>/export?format=csv`.
- **TouchDesigner** gets the room over a WebSocket from the browser (`src/lib/agent/touchDesigner.ts` → the receiver on port 9980). The receiver's code is `public/touchdesigner/build_immersive_lab.py`; the lab Mac's setup scripts are copied into `touchdesigner/lab-mac-scripts/` (see §9 and `touchdesigner/PROJECTORS_5_6_TOUCHDESIGNER.md`). Their absolute paths point at the lab Mac.
- **Older handoffs** in the repo root explain earlier versions: `HANDOFF_V4…V7`, `SHOW_FORMAT.md`, `HOSTING.md`, `FIGJAM_PLUGIN_HANDOFF.md`.

## A7. Where to start on v11

The most useful next steps, in order:
1. Test in the room what is only type-checked (§11 below): chatbot voice placement, the new tour, the scene label live, the permission re-ask, W4-01 buttons, dual microphones in a call.
2. Move the projector-screen rule into the receiver (`heal_screens`), so macOS reshuffling the displays fixes itself.
3. Label the speaker for push-to-talk too (only the open mic does now).
4. Have the studio warn when a media file's content doesn't match its ending (the fake-PNG problem in §7), before it reaches TouchDesigner.
5. Team ED's media folders into `~/Documents/2026 Fall Student Work/Team ED/` on the lab Mac.

---

# Part B — What v10 contains

## Contents

1. [What v10 adds, at a glance](#1-what-v10-adds-at-a-glance)
2. [Zones and the room drawing](#2-zones-and-the-room-drawing)
3. [Room buttons and sensors (MQTT)](#3-room-buttons-and-sensors-mqtt)
4. [Voice, microphones and replies](#4-voice-microphones-and-replies)
5. [Sound: master volume, spatial audio, chatbot voice](#5-sound-master-volume-spatial-audio-chatbot-voice)
6. [The scene label on the wall](#6-the-scene-label-on-the-wall)
7. [Student teams: files and TouchDesigner](#7-student-teams-files-and-touchdesigner)
8. [The Adding Immersive Media tour](#8-the-adding-immersive-media-tour)
9. [TouchDesigner receiver: messages and updating it](#9-touchdesigner-receiver-messages-and-updating-it)
10. [Troubleshooting](#10-troubleshooting)
11. [Tested, untested, still open](#11-tested-untested-still-open)
12. [Where the code is](#12-where-the-code-is)

---

## 1. What v10 adds, at a glance

| Area | What it does | Commit |
|---|---|---|
| Zones 1 and 3 | Two more corners of the room (projectors 5 and 6), three faces each, alongside zone 2 (projectors 1–4) | f7eb65b and earlier |
| Record conversation | One MP3 per conversation: voice, studio sounds and microphone | 25ba4dd |
| MQTT room buttons | sb-NN and W4-0N Zigbee buttons start the call, switch the mic, step through scenes | d39c4d9, d57b14b |
| Dual microphones | Two people on a DJI stereo receiver; each sentence labelled with who said it | d39c4d9, d57b14b |
| Master volume / Sound On-Off | One level for everything the studio plays, and a mute | d39c4d9 |
| Team-safe files | Every export says its team; imports only into the same team | d39c4d9 |
| Faster replies | ⚡ Fast (Haiku), replies written ahead | d39c4d9 |
| "Stop the music" | Works in every scene; the mic switches off while asked-for music plays | d57b14b |
| Scene label | Mic on/off, scene number and title on zone 1 · area 2 | 0e59d65 |
| Chatbot voice | 0–400% volume on chatbot bars; place the voice in the room | 0e59d65 |
| Media tour | Onboarding now demonstrates drag and drop, zones, spatial audio, TouchDesigner, dual mics | 0e59d65 |
| Student folders in TouchDesigner | TouchDesigner finds each team's media in `Documents/2026 Fall Student Work/<Team>` | 0e59d65 |
| Drawing stays filled | Pictures and chatbots come back after a reload, Refresh This Scene or clearing | b535275 |

---

## 2. Zones and the room drawing

- **Zone 2** is the original room: areas 1–11 on projectors 1–4. **Zone 1** (projector 5) and **zone 3** (projector 6) have three faces each. People see per-zone numbers ("Zone 1 · area 2"); inside the app and TouchDesigner they are areas 12–14 (zone 1) and 15–17 (zone 3). See `src/lib/agent/projectionLayout.ts`.
- The **Zone 1 / 2 / 3** buttons in the top bar choose which zone's drawing shows.
- On the **timeline**, each zone has a dark heading (**Z1**, **Z2**, **Z3**) that folds its rows open and closed. Each section's number opens it into **five tracks** (e.g. 2.1–2.5): up to five different pieces of media for that section. Each zone ends in its green **♪ sound track**.
- **Getting media in:** drag a picture, video, colour, text or AI character from the Media Library onto a section's row of the timeline, or straight onto a section of the drawing. Either way it plays **on marker arrival** at that stage; its bar's **▼** can connect it to a sheet action instead. Sounds go on the ♪ track.
- **Bars:** drag an end to stretch across stages, drag the middle to move, Option-drag to copy, × to delete.
- The drawing is a **live preview** of the room: whatever is on the marker's stage shows there and in TouchDesigner. Since b535275 it stays filled after a page reload (see §10), after **Refresh This Scene** and after clearing the conversation.

---

## 3. Room buttons and sensors (MQTT)

Section **7 · Room buttons & sensors (MQTT)** of Adding Immersive Media.

- Broker: Mosquitto on `pi02zigbee.local:1883`, no login, topics under `/cca/r140/#`. The name resolves to several addresses; the server tries the last good one, then the looked-up IPv4, then `MQTT_BROKER_ADDRESSES` (default `10.42.0.1`). Only works where the studio runs on the lab Mac (404 on Vercel).
- Server: `src/lib/mqttBroker.ts` (one client, kept across reloads), `src/app/api/mqtt/route.ts` (GET = live events, POST = connect / disconnect / publish).
- Page: `useMqttMessages` and `isPress` in `src/lib/agent/mqttEvents.ts`; the panel is `src/components/agent/MqttPanel.tsx`.

| Button | Does |
|---|---|
| sb-02 | Open mic on / off |
| sb-03 | "Agent speaks first" (only before a conversation starts) |
| W4-01 button 1 | Previous scene (sheet order; stays at the first) |
| W4-01 button 2 | Next scene (stays at the last) |
| W4-01 button 3 | "Agent speaks first" |
| W4-01 button 4 | Open mic on / off |

Single presses only; double presses light the panel but do nothing. The mapping is in `src/app/agent/page.tsx` (the `useMqttMessages` block near the top).

---

## 4. Voice, microphones and replies

### Open mic and "stop the music"
- When music someone **asked for** starts, the open mic switches **off** (a chat note says so) so the song's lyrics aren't heard as speech. Turn it back on with sb-02 / W4-01 button 4 / the 🎙️ button.
- "Stop / pause / kill / turn off the music (or song)" stops asked-for sounds straight away, in every scene (`STOP_MUSIC` in `src/lib/agent/mediaPlayback.ts`).

### Dual microphones (section 8)
- Hardware: DJI Mic receiver ("Wireless Mic Rx") in **stereo** mode — transmitter 1 on the left channel, 2 on the right. macOS's input must be the receiver (set by hand in System Settings).
- The app opens the same input, splits left and right, and labels each sentence with the louder side: `Dave (nurse): …`. The responder is told there are two people and answers whoever spoke.
- **Names:** the scene's sheet row 11 "People in this scene" (`Name: role`, one per line) if filled; otherwise the AI reads them from the scene's text. **For students:** in the sheet's *Describe this conversation* section, make it clear there are two people, name them and give the rules for each. The first person named is on the **left** mic, the second on the **right**; section 8 shows who is on which side. Giving each actor the right microphone is the student's job.
- A music filter drops sentences equally loud on both mics (room music).

### Replies
- **⚡ Fast** beside Send: replies written by Haiku instead of Sonnet.
- Replies are written ahead for the stages the caller could move to, and the right one is used if the conversation moves.

---

## 5. Sound: master volume, spatial audio, chatbot voice

### Master volume and Sound On / Off
Right of the zone buttons. Every sound the studio plays (voice, timeline sounds, video soundtracks, background music) goes through one master level; TouchDesigner's sound level follows it. **Sound: Off** stops everything and keeps it silent until turned on again.

### Spatialized audio (section 6)
- The room seen from above, a speaker in each corner (GIGAPORT eX outputs 1–4; Chrome's channel order is compensated in `BROWSER_CHANNEL_FOR_SPEAKER`).
- **Click a sound's bar** on the timeline — or a video's bar if the video has sound — and section 6 opens on it. Drag the **blue dot** to balance it between the speakers (a corner = that speaker only; the middle = all four evenly). The position is remembered for that sound in that scene.
- **● Record Movement:** the sound plays and wherever you move the dot is recorded; it then moves round the room the same way every time it plays. Record again to replace it, or delete the recording.

### Chatbot voice (new in 0e59d65)
- A chatbot (AI character) bar on the timeline has a **0–400% volume slider**, like a sound bar (no loop button).
- **Clicking a chatbot bar** opens section 6 on it ("💬 name (chatbot voice)"). The dot sets where the **voice** comes from; it's saved like a sound's position.
- While that chatbot is showing in the room, the voice plays from its place at its bar's volume (multiplied by the Voice panel's own volume). With no chatbot showing, the voice plays evenly on all four speakers, as before. If two are showing, the first one decides.
- Code: `src/lib/agent/chatbotVoice.ts` (watches what's showing), `setVoicePlacement` in `mediaPlayback.ts` (one gain per speaker on the voice).

---

## 6. The scene label on the wall

- A small dark strip in the **top-left corner of zone 1 · area 2** (area 13, the right wall on projector 5), about 3.4 in tall, clear of the panel below it. Left to right: a **microphone badge** (green = the open mic or push-to-talk is listening; red and crossed out = off), the **scene number** in bold, the **scene title** (cut with "…" if long).
- The studio draws it as a see-through PNG the size of an area's picture, in wall inches so it isn't stretched by Kantan, and sends it when the mic or scene changes and each time TouchDesigner connects (`src/lib/agent/sceneLabel.ts`).
- TouchDesigner lays it over area 13's media (`label_pic13` → `label_over13`, between `fade13` and `area13`, made the first time a label arrives). The PNGs are saved in turn as `scene_labels/area13_a.png` / `_b.png` beside the .toe.
- **Show / Hide scene label** in section 4 (remembered per browser).

---

## 7. Student teams: files and TouchDesigner

### Teams in the studio
The **Team ED / Team AE / Graham** buttons give each team its own copy of the whole app in the browser (keys, scenes, media connections, layout). Exported files carry the team inside and in the name, and only import into the same team:

| What is saved | Team ED | Team AE |
|---|---|---|
| Export Project | `chatbot-designer-project-team-ED-<date>.json` | `chatbot-designer-project-team-AE-<date>.json` |
| Export all scenes | `Chatbot Designer scenes team-ED <date>.json` | `Chatbot Designer scenes team-AE <date>.json` |
| One scene | `team-ED - <scene name>.goal-agent.json` | `team-AE - <scene name>.goal-agent.json` |
| Show file copy | `show team-ED.json` | `show team-AE.json` |
| Automatic backup (lab Mac) | `.local-backup/team-ED.json` | `.local-backup/team-AE.json` |

### Where student media must live
```
~/Documents/2026 Fall Student Work/
  Team AE/
    Waiting Room_01/        ← a scene's media folder (choose it in 1 · Media folder)
  Team ED/
    <scene folder>/
```
The studio sends TouchDesigner only the scene folder's **name** (the browser can't say where it is on disk). TouchDesigner looks in its own Media Folder first, then in `~/Documents/2026 Fall Student Work/<Team>/<folder>/` — the sending team's folder first (messages carry `"team": "Team AE"`), then any team's. Team folders must be named exactly **Team AE** / **Team ED**.

### Picture files must really be what their name says
Chrome reads a picture by its content; TouchDesigner goes by the ending. A WebP or JPEG renamed to `.png` shows in the studio but is **blank on the projectors**. On 2026-11-15, 11 of Team AE's "Waiting Room_01" pictures were like this; they were converted to real PNGs under the same names (`sips -s format png`), with the originals kept in `Waiting Room_01/Originals before PNG`. The Media Library skips any top-level folder named `Originals before …`. Students should export images properly from an image app rather than renaming the ending.

Check a folder from Terminal:
```bash
cd "$HOME/Documents/2026 Fall Student Work/Team AE/Waiting Room_01" && file *.png
```
Every line should say `PNG image data`.

---

## 8. The Adding Immersive Media tour

**Onboard Me** beside Adding Immersive Media runs a 20-step tour on a demo scene with its own demo files (a video, a picture, a ding and an 8-second music clip in `public/onboarding-media/`), so a student's work is never touched; the demo is cleared away when the tour ends.

Steps: intro → choose/connect the media folder → the Media Library → **drag a picture onto the timeline** → **drop the video on the drawing** → **drag music onto the ♪ track** → connect a file to an action → When it plays / Try it → sounds connect the same way → the timeline → **open and close zones** → **up to 5 spaces in each section** → arrange a bar (stretch across stages, move, copy) → delete a bar → **place a sound in the room** (click its bar, drag the dot) → **record a movement** (then plays it back) → **TouchDesigner: projectors and labels** (Connect/Disconnect, Show projections, Show/Hide numbers, Show/Hide scene label — pointed at, never clicked) → **two people, two microphones** → Refresh This Scene → done.

Code: `src/components/agent/mediaTour.tsx` (steps and demonstrations), `OnboardingTour.tsx` (the pointer; `dragTo` does HTML drag and drop with a scripted DataTransfer), `src/lib/agent/mediaDemo.ts` (the demo scene).

---

## 9. TouchDesigner receiver: messages and updating it

The receiver is a Web Server DAT in `/project1/immersive_lab` on port **9980** (WebSocket from the studio; HTTP POST of the same JSON for testing). Its code lives in `build_immersive_lab.py` (two copies: `Claude/TouchDesigner/` on the lab Mac with that Mac's Media Folder, and `public/touchdesigner/` in this repo; they differ only in `MEDIA_FOLDER`).

**Updating the running receiver** without rebuilding (keeps Kantan shapes, area labels, the Media Folder), in TouchDesigner's Textport:
```python
exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/update_receiver.py').read()); project.save(); print('saved', project.name)
```

Messages added or changed in v10:

| Message | Does |
|---|---|
| `{"type":"label","action":"show","area":13,"png":"<base64>"}` | Lays the scene label over that area's media |
| `{"type":"label","action":"hide","area":13}` | Takes it off |
| `{"type":"numbers","action":"show"\|"hide"\|"status"}` | Area numbers on the shapes (area_labels) |
| `{"type":"kantan","action":"open","mapper":"p56"}` | Opens Kantan for projectors 5 & 6 |
| `"team": "Team AE"` on media / sound / medialist | Which team's folder to look in first |
| `hello` → `ready` now includes `width`, `height` | The size of an area's picture (the label is drawn at it) |

Quick checks from Terminal on the lab Mac:
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"type":"hello"}' http://localhost:9980/
```
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"type":"medialist","folder":"Waiting Room_01","team":"Team AE","items":[{"id":"t","path":"wr-panel6-window.png"}]}' http://localhost:9980/
```
The second should answer `1 of 1 files found` (note: it replaces TouchDesigner's media_list table until the studio sends its own again).

`touchdesigner/lab-mac-scripts/area10_diag.py` (on the lab Mac: `Claude/TouchDesigner/area10_diag.py`) writes TouchDesigner's message log, now_playing and one area's state to `area10_diag.txt` — edit the `for a in (…)` line for other areas.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Picture shows in the studio, blank on the projectors; TouchDesigner log says **file missing** | The scene folder isn't in TouchDesigner's Media Folder or a `2026 Fall Student Work/<Team>` folder | Move the scene folder into the team folder (§7) |
| Log says **shown** but the projector is blank; area's movie TOP is 256 × 256 | The file isn't really what its ending says (WebP/JPEG named .png) | Convert it (§7) |
| Pictures vanish from the drawing when you click away, after the page reloaded | Chrome forgets permission to read the media folder after a reload | Click once on the drawing or timeline and choose **Allow** (or **Allow on every visit**); the timeline's red note says when a picture couldn't show |
| Everything disappears after Refresh This Scene / clearing | Fixed in b535275 (the marker's stage is put back up) | Reload the studio if it's older |
| Nothing reaches TouchDesigner | Studio not connected, or connected before a scene opened | Section 4: Disconnect, then Connect |
| Wall projectors show the wrong sections | macOS reshuffled the displays | `Claude/TouchDesigner/fix_projector_screens_auto.py` (see `PROJECTORS_5_6_TOUCHDESIGNER.md` on the lab Mac) |
| Video jerky after many hours | TouchDesigner slows down over long uptime | Save, quit and reopen TouchDesigner; then Show projections |

**Don't** quit Chrome on the lab Mac: its profile is ephemeral and loses all browser storage (keys, scenes, media connections). The automatic backup in `.local-backup/` restores a team's copy.

---

## 11. Tested, untested, still open

**Seen working (2026-11-15):** the scene label on projector 5's output; TouchDesigner finding Team AE's files; Team AE's converted window picture on projector 4 (zone 2, section 10); the chatbot reaching TouchDesigner's area 6.

**Checked with type-check and lint only, not yet seen in use:**
- Chatbot volume and voice placement (needs a call in the room with a chatbot showing).
- The new tour steps (run Onboard Me → Adding Immersive Media from the start; choose **Start again** if it offers to resume the old tour).
- The scene label changing live with the mic and scene buttons.
- Permission re-ask on the first click, and the drawing refilling after Refresh This Scene.
- From d57b14b: W4-01 buttons, mic off when asked-for music starts, dual microphones in a real call.

**Still open:**
- Put the projector-screen auto rule into the receiver's `heal_screens` (until then run `fix_projector_screens_auto.py` by hand).
- Push-to-talk 🎤 doesn't label the speaker (only the open mic does).
- Dual mics: two people talking at once may be dropped as music.
- The sheet's Apps Script needs updating to write the media list back (section 1 shows the note).
- Team ED's media folders aren't in `2026 Fall Student Work/Team ED` yet.

---

## 12. Where the code is

| Path | What |
|---|---|
| `src/app/agent/page.tsx` | The studio page: MQTT buttons, open mic, scene label feed, `stopSceneMedia` (clears and replays the marker) |
| `src/lib/agent/projectionLayout.ts` | Zones, areas, shapes, wall sizes in inches |
| `src/components/agent/MediaTimeline.tsx` | Timeline: zones, 5 tracks per section, bars, volume sliders, drop from the library |
| `src/components/agent/MediaWorkspace.tsx` | Room drawing: drop on an area, placing pictures |
| `src/lib/agent/markerPlay.ts` | "On marker arrival": what shows on the marker's stage; `regainMediaFolder` |
| `src/lib/agent/mediaShow.ts` | What each area is showing |
| `src/lib/agent/mediaPlayback.ts` | Sounds, limiter, voice graph (`setVoicePlacement`), `STOP_MUSIC` |
| `src/lib/agent/spatialAudio.ts`, `src/components/agent/SpatialAudioPanel.tsx` | Positions, recorded movements, the square |
| `src/lib/agent/chatbotVoice.ts` | Chatbot bars → voice place and volume |
| `src/lib/agent/sceneLabel.ts` | The scene label PNG |
| `src/lib/agent/touchDesigner.ts`, `src/components/agent/TouchDesignerPanel.tsx` | Link to TouchDesigner, section 4 |
| `src/lib/agent/dualMic.ts`, `src/components/agent/DualMicPanel.tsx`, `src/app/api/agent/people/route.ts` | Dual microphones |
| `src/lib/mqttBroker.ts`, `src/app/api/mqtt/route.ts`, `src/components/agent/MqttPanel.tsx` | MQTT |
| `src/lib/team.ts` | Teams, file tags, import checks |
| `src/lib/agent/mediaFolder.ts` | Media folders, library scan, connections (links) |
| `src/components/agent/mediaTour.tsx`, `OnboardingTour.tsx`, `src/lib/agent/mediaDemo.ts` | Onboard Me tours |
| `public/touchdesigner/build_immersive_lab.py` | TouchDesigner receiver (build script) |
