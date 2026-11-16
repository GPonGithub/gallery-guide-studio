# Projectors 5 & 6 in TouchDesigner: technical reference (2026-11-09)

How the six-projector setup is built in the StudioMap file. The main handoff is [`SESSION_HANDOFF_2026-11-09.md`](SESSION_HANDOFF_2026-11-09.md).
Scripts are in `Claude/TouchDesigner/`. The TouchDesigner file is `Fall 2026 Grahams Work/TouchDesigner_Graham_Fall_2026/F2026_StudioMap_r1.45.toe`.

---

## 1. Screens

`system_profiler SPDisplaysDataType` shows 7 displays: the Acer KG281K (main, 3840×2160, looks like 1920×1080) and six "EPSON PJ".

TouchDesigner's `monitors`, numbered **by position, left to right** (pixel coordinates):

| TD monitor | Size | Left x | macOS name | Room projector |
|---|---|---|---|---|
| 0 | 1920×1080 | −4480 | EPSON PJ (4) | **5** (new space) |
| 1 | 2560×1080 | −2560 | EPSON PJ (5) | **6** (new space) |
| 2 | 3840×2160 | 0 | Acer, PRIMARY | (the computer's screen) |
| 3 | 1920×1080 | 3840 | EPSON PJ (6) | wall projector 1 |
| 4 | 1920×1080 | 5760 | EPSON PJ (1) | wall projector 2 |
| 5 | 1920×1080 | 7680 | EPSON PJ (3) | wall projector 3 |
| 6 | 1920×1080 | 9600 | EPSON PJ (2) | wall projector 4 |

(macOS's window coordinates are in points: the Acer is 1920 wide there, so a wall window at macOS x 1920 = TD x 3840.) The wall screens left to right are now projectors **1, 2, 3, 4**, which is the order Greg's `projectorBlend` expects.

**Gotchas**
- TouchDesigner renumbers monitors when one is added or removed, but open windows stay where they are. Their `display` parameter then points at the wrong monitor, and the wrong screen shows only when a window is next reopened. Adding the two projectors on the left shifted every number by +2.
- Five Epsons report serial `1010101` (one reports `1010141`), so macOS can reshuffle identical projectors after a restart. Fix that with the swap in §4.

---

## 2. `/project1/projector_out` (projector windows)

Built by `projector_output.py` (windows 1–4) and `add_projectors_5_6.py` (windows 5–6).

- Custom pars: **Identify** (shows "PROJECTOR N") and **Testcolours** (solid colour per projector).
- Windows 1–4: `sectionN` crops the blend (`/project1/MAPPER/projectorBlend/out1`, 7680×1080) into quarters → `projectorN` switch (0 = picture, 1 = tagged with "PROJECTOR N", 2 = test colour) → `windowN`.
- Windows 5–6: `p56` (selectTOP of `/project1/MAPPER/kantanMapper_P56/out1`) → `kantan5` (crop 0–0.4286) and `kantan6` (crop 0.4286–1) → `projector5/6` switch input 0. `tagged5/6` puts "PROJECTOR 5/6" over the shapes; `test5/6` is magenta/cyan. Window 6 is 2560×1080.
- Each window stores `screen_at = [left, top]` (its screen by position); see §3.

**Rebuilding (fixed 2026-11-09):** `projector_output.py` now builds **all six** windows:
- 1–4 from the blend; 5–6 from `kantanMapper_P56` through the selectTOP `p56` and the crops `kantan5/6` (plain black if that mapper is missing).
- It puts each window back on the screen it was on, found by `screen_at` position (falling back to `SCREEN_OF_PROJECTOR = {1:3, 2:4, 3:5, 4:6, 5:1, 6:2}`, counted from the left).
- It keeps Identify and Testcolours.

Tested by a full rebuild: every window came back on its own screen, and IDs 1–6 were checked on each. Saved r1.46. The app repo copy is the same file (v10 `f5e5f00`). `add_projectors_5_6.py` and `p56_wire.py` are no longer needed for a rebuild.

---

## 3. Receiver changes (`build_immersive_lab.py`, CALLBACKS)

Loaded into `/project1/immersive_lab/receiver_callbacks` with `update_receiver.py`. The repo copy `gallery-guide-studio/public/touchdesigner/build_immersive_lab.py` is kept identical, except its `MEDIA_FOLDER` line (the other Mac's path).

- `monitor_at(left, top)`, `remember_screens(wins)` and `heal_screens(wins)`: before every `projectors` action, each window's `display` is reset from its remembered position (`screen_at`). After an `assign` (swap), the new positions are remembered. Windows without `screen_at` get it from their current number.
  - Test: `projector_screens_test.py` sets window 1's number wrong without reopening it, sends `status`, and checks it comes back. Result: **PASS**.
- `kantan` open/close accepts `"mapper": "p56"` → `/project1/MAPPER/kantanMapper_P56`. Without it, the message goes to the walls' `kantanMapper1` as before.

---

## 4. Messages (ws:// or HTTP POST to `localhost:9980`)

| Message | Effect |
|---|---|
| `{"type":"projectors","action":"status"}` | `{"count":6,"identify":…,"open":6}` |
| `{"type":"projectors","action":"identify","on":true}` | "PROJECTOR N" on all six |
| `{"type":"projectors","action":"open"}` / `"close"` | the six full-screen windows |
| `{"type":"projectors","action":"assign","shows":[2,3,1,4,5,6]}` | swap: `shows[r-1]` = the number room projector r currently shows; afterwards each shows its own |
| `{"type":"kantan","action":"open","mapper":"p56"}` | open the projector 5/6 Kantan editor (`close` too) |

HTTP example (no Textport needed):
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"type":"projectors","action":"status"}' http://localhost:9980/
```

In the app (v10, `src/components/agent/ProjectorsPanel.tsx`), Immersive Media step 5:
- **Show projector IDs**, then one row per projector ("Projector N shows …"), then **Apply**;
- **Open Kantan Mapper** (walls) and **Open Kantan 5 & 6**;
- **Close** closes both editors.

The step asks for `status` whenever it opens.

---

## 5. The second Kantan Mapper: `/project1/MAPPER/kantanMapper_P56`

- A copy of `kantanMapper1`. The original and its 11 shapes are untouched (checked: 11).
- `project` Resolution **4480 × 1080**. Canvas x runs from −2240 to +2240 (centre 0): projector 5 is x −2240 to −320, projector 6 is −320 to +2240.
- Shapes (Kantan item id → name, colour, starting centre x, size). All are plain rectangles with corner offsets reset and `Handlelock` off:

| id | name | colour | centre x | size |
|---|---|---|---|---|
| 1 | p5_shape1 | red | −1920 | 520×640 |
| 3 | p5_shape2 | green | −1280 | 520×640 |
| 4 | p5_shape3 | blue | −640 | 520×640 |
| 6 | p6_shape1 | yellow | 107 | 660×640 |
| 7 | p6_shape2 | magenta | 960 | 660×640 |
| 8 | p6_shape3 | cyan | 1813 | 660×640 |

- Textures: `/project1/MAPPER/p56_textures/shape1…6` (`colourN` constant 800×800 + `labelN` text "5-1"… → `shapeN` over). **Kantan draws a shape only through its texture**: with Showtexture off, the output is black.
- To put real media on a shape, set that item's `parameters` `Texture` to a TOP path (e.g. future `immersive_lab/area12`). Pattern: `connect_kantan_areas.py`.
- Open the editor: the app button, or `op('/project1/MAPPER/kantanMapper_P56').par.Open.pulse()`. Corner dragging only works while the timeline plays (`op('/').time.play = True`).
- `Bgmask` still points at `/project1/MAPPER/bg1` (copied from the walls' mapper). Harmless while Showbg is off.

**Kantan internals learned**
- The Python extensions are compiled: `inspect.getsource` fails.
- `DeleteShape()` from Python raises "list index out of range". To delete shapes, remove their rows from `project/tree` and the same rows from `project/allShapes/table1`. The replicator (template `allShapes/elements`) then drops the items.
- A shape's definition (`item.GetDefinition()` / `SetDefinition(defDict=…, undo=False)`):
  - `parameters` (Name, Color*, Texture, Showtexture, …);
  - `shapeDef` (`keyOffset` corner offsets, `homography`, …);
  - `shapeXform` (`tdu.Matrix` text: scale on the diagonal, translate x/y in items 12/13, canvas-centred pixels).
- Wires can't cross networks. Use a `selectTOP` to bring a TOP from another component.

---

## 6. Scripts (all in `Claude/TouchDesigner/`)

Run each from the Textport with `exec(open('<full path>').read())`.

| Script | What it does | Status |
|---|---|---|
| `add_projectors_5_6.py` | adds window5/6 (+ black / tag / test) on the screens 1–4 don't use | done. **Trusts `display` numbers; check them first** |
| `fix_projector_screens.py` | one-off: windows 1–4 `display` +2, 5 → monitor 0, 6 → monitor 1 (2560 wide) | done (guarded by stored flag) |
| `projector_screens_test.py` | loads the receiver code, tests screen healing | PASS |
| `kantan_probe.py`, `kantan_probe2.py` | read-only dumps of MAPPER / Kantan (`kantan_probe*.txt`) | reference |
| `add_kantan_p56.py` | makes `kantanMapper_P56` (copy, 4480 canvas, 6 rects), wires windows 5/6 | done (its wiring and deletes failed, fixed below) |
| `p56_textures.py` | labelled colour textures for the 6 shapes; logs Kantan's tables | done |
| `p56_remove_extra.py` | deletes copied shapes 9–13 via tree/table1 rows | done |
| `p56_wire.py` | selectTOP `p56` → crops `kantan5/6` | done |
| `p56_diag.py` | read-only: picture levels along the chain | reference |
| `update_receiver.py` | reloads receiver code from the build script | use after editing CALLBACKS |

Saves: r1.42 (six projectors placed), r1.43 (screen memory), r1.44 (P56 mapper), r1.45 (Kantan "mapper" message), **r1.46** (projector_out rebuilt by the six-projector `projector_output.py`).

---

## 7. To do for the new spaces

1. Graham supplies two SVGs (one per space, each with 3 shapes).
2. Decide the numbering: continue the walls' areas (12–17) or separate spaces. **Ask Graham.**
3. TouchDesigner: create area TOPs for the new shapes (extend `build_immersive_lab.py` without rebuilding immersive_lab, since rebuilding disturbs Kantan links and area labels), point the P56 shapes' `Texture` at them, and keep the coloured textures as a "test" mode or remove them.
4. App: room drawing and areas for each space, timeline rows, placement (`areaUvMatrix`), show.json, and messages for the new areas.
5. ~~Extend `projector_output.py` to six windows~~: done (r1.46).
