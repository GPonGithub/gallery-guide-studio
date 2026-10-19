# The show file (`show.json`)

The Chatbot Designer saves everything the room needs in one readable file, `show.json`, in the
**media folder** beside the files it lists. It is kept up to date as students work (Adding
Immersive Media → 3 · Show file), and can be downloaded (Save a Copy) and opened again (Open Show).

The format is a **superset of Show Control's `show.json`** (Greg Cowley's
[imr-showcontrol](https://github.com/gregorycowley/imr-showcontrol)): `cast`, `score.regions[].spans`
and `playhead` mean what they mean there, so Show Control's tools and its TouchDesigner reader
(Text DAT with Sync to File → JSON DAT) keep working. Everything else is added alongside.

Code: `src/lib/agent/showFile.ts` (format, build, read), `src/lib/agent/showSave.ts` (saving).

## Top level

| Field | Show Control | Meaning |
|---|---|---|
| `format` | added | Always `"immersive-lab-show"`. |
| `version` | added | Format version, now `1`. |
| `savedAt` | added | When it was written (ISO time). |
| `mediaFolder` | added | The media folder's name. Paths are relative to it. |
| `cast` | ✓ | The media library: one member per file. |
| `score` | ✓ | `{ regions }` for the **first scene** — Show Control shows one score at a time. |
| `playhead` | ✓ | Frame to show; always `1` when saved. |
| `scenes` | added | Every scene from the Google Sheet, each with its stages and its own score. |
| `connections` | added | The complete record of which file is connected to which action, and how. |

## `cast[]`

```json
{ "id": "M-001", "number": 1, "name": "Maya.jpg", "kind": "image", "path": "nurse/Maya.jpg", "status": "present" }
```

- `id` is the file's lasting ID from the media library (the sheet's Media tab), e.g. `M-001`.
- `kind` is `video`, `sound`, `image`, `text` or `color`. Show Control knows `video`, `sound`,
  `text`, `color`; `image` is added (a Movie File In TOP plays images and video alike).
- `path` is relative to the media folder (video, sound, image); `value` holds the words (text) or a
  hex colour (color).
- `status` is `missing` if the file wasn't in the folder at the last refresh.

## Frames are stages

Show Control counts frames 1–30. Here each scene's **frame n is its n-th conversation stage**, in
order (`scenes[].stages[n - 1]`, e.g. 1, 2A, 2B, 3…). A span's `start` is the first stage it covers
and `length` how many.

## `scenes[]`

```json
{
  "sheetId": "1AbC…", "number": "4", "name": "Outreach Call",
  "stages": [{ "code": "1", "name": "WELCOME", "goal": "Greet the caller…" }, { "code": "2A", "name": "…" }],
  "score": {
    "regions": [{ "region": 1, "spans": [{ "id": "…", "memberId": "M-007", "start": 1, "length": 3,
                  "action": "Play the abstract landscape video when user asks", "lane": 1 }] }],
    "sound": [{ "track": 1, "spans": [{ "id": "…", "memberId": "M-014", "start": 1, "length": 5, "action": "…" }] }]
  }
}
```

- `regions` has **11** entries, one per projection area of the room drawing (Show Control has 10;
  the room has 11 — region 11 is added).
- A span's `lane` (1–5) is which of the area's five tracks it sits on.
- `sound` holds up to five sound tracks.
- `action` is the media action (row 8 of the sheet) the span belongs to. **When it plays is not a
  fixed time**: it comes from the action's timing in `connections` — "once" actions wait for their
  moment in the conversation, "every time" ones repeat, "throughout" ones run from the call's start.

## `connections[]`

```json
{
  "memberId": "M-007", "sheetId": "1AbC…", "sceneNumber": "4", "sceneName": "Outreach Call",
  "action": "Play the abstract landscape video when user asks",
  "timing": { "kind": "once" }, "loop": true,
  "bars": [{ "track": 1, "from": "1", "to": "2A" }, { "track": "5-2", "from": "1", "to": "1" }]
}
```

- `timing.kind`: `once`, `every`, `throughout`, `start`, `end`; for `every` also `when`
  (`before-reply`, `reply-start`, `after-reply`, `caller-speaks`), `voice` (`wait`, `over`, `delay`)
  and `delay` (seconds). Missing fields mean "as read from the action's words".
- `loop`: video/sound loops while on (default), or plays once.
- `bars[].track`: an area `1`–`11`, an area's extra track `"5-2"`…`"5-5"`, or a sound track
  `"sound"`, `"sound-2"`…`"sound-5"`. `from`/`to` are stage codes.

Open Show matches members to the library by **path**, so a show opened on another computer finds
the same files even if their IDs differ.

## Live messages

During a conversation the app also sends live messages to TouchDesigner over a WebSocket
(`public/touchdesigner/build_immersive_lab.py`, its `message_guide` table): the show file says what
*can* happen and where; the live messages say what *is* happening now.
