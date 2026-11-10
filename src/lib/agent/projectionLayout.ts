/**
 * The room's projection areas, as the drawings show them. There are three zones, each with its own
 * drawing and its own projectors:
 *
 *   Zone 1  three faces on projector 5   ("Immersive Rook Projection Outlines ZONE 1_01.svg")
 *   Zone 2  the 11 areas on projectors 1–4, seen from the front ("Immersive Space Projection
 *           Outlines_03.svg": the room drawing itself is public/room/projection-room.svg, without
 *           its outlines and numbers)
 *   Zone 3  three faces on projector 6   ("Immersive Rook Projection Outlines ZONE 3_01.svg")
 *
 * Every area has one number for the whole app — its timeline track, its messages to TouchDesigner, the
 * show file: 1–11 are zone 2's, 12–14 zone 1's faces 1–3, 15–17 zone 3's faces 1–3. People only ever
 * see an area's number within its zone (areaNumber): "Zone 1 · area 2".
 *
 * All three drawings share one coordinate space, so a placement (roomPlacement.ts) means the same
 * thing everywhere: zone 2 sits where it always has (from 0, 0), zone 1 from x = 3000 and zone 3 from
 * x = 6000. Each zone's `view` is the part of that space its drawing shows.
 */

export type ProjectionShape = {
  area: number;
  points: [number, number][];
  /** Where its number sits. */
  label: [number, number];
  /** Small areas get a smaller number. */
  small?: boolean;
  /** Filled white (in the drawing, area 1 covers what's behind it). */
  filled?: boolean;
  /** Areas inside this one: its media leaves them out (they stay white, or show their own). */
  holes?: number[];
  /**
   * The surface's own four corners (top-left, top-right, bottom-right, bottom-left) where the outline
   * isn't simply those four points — a wall drawn around a panel. None: see cornersOf (roomPlacement.ts).
   */
  corners?: [number, number][];
  /** The real surface, in inches (width, height) — zones 1 and 3; zone 2's are in Projection Templates. */
  inches?: [number, number];
};

export type ZoneId = 1 | 2 | 3;
export type Zone = {
  id: ZoneId;
  /** The part of the shared drawing space this zone's drawing shows. */
  view: { x: number; y: number; w: number; h: number };
  /** Its drawing (behind the outlines), covering `view` — zone 2's room. */
  drawing?: string;
  /** Its areas' numbers (app-wide), in the order people count them: 1, 2, 3… */
  areas: number[];
  /** The projectors that light it. */
  projectors: number[];
};

export const LAYOUT_SIZE = { width: 1566.13, height: 679.46 } as const;
export const ROOM_DRAWING = '/room/projection-room.svg';

/** The whole shared drawing space (every zone, with room to spare): what a mask over it must cover. */
export const DRAWING_SPACE = { x: -500, y: -500, width: 8500, height: 2000 } as const;

export const ZONES: Zone[] = [
  { id: 1, view: { x: 3000, y: 0, w: 1014, h: 596 }, areas: [12, 13, 14], projectors: [5] },
  { id: 2, view: { x: 0, y: 0, w: LAYOUT_SIZE.width, h: LAYOUT_SIZE.height }, drawing: ROOM_DRAWING, areas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], projectors: [1, 2, 3, 4] },
  { id: 3, view: { x: 6000, y: 0, w: 1112, h: 666 }, areas: [15, 16, 17], projectors: [6] },
];
export const zoneById = (id: ZoneId) => ZONES.find((z) => z.id === id)!;
/** The zone an area is in (zone 2 for anything unknown — the areas there before zones existed). */
export const zoneOfArea = (area: number): Zone => ZONES.find((z) => z.areas.includes(area)) ?? zoneById(2);
/** An area's number as people see it: its place within its zone (1, 2, 3…). */
export const areaNumber = (area: number): number => {
  const i = zoneOfArea(area).areas.indexOf(area);
  return i < 0 ? area : i + 1;
};
/** "Zone 1 · area 2" — an area named in full. */
export const areaName = (area: number) => `Zone ${zoneOfArea(area).id} · area ${areaNumber(area)}`;
/** Every area, zone by zone. */
export const ALL_AREAS = ZONES.flatMap((z) => z.areas);

export const PROJECTION_SHAPES: ProjectionShape[] = [
  { area: 1, points: [[78.59, 413.8], [31.5, 427.58], [7.38, 281.7], [59.06, 277.11]], label: [37, 342], filled: true },
  {
    area: 2,
    points: [[436.46, 203.43], [439.68, 266.21], [84.33, 342.58], [47.58, 31.3], [452.58, 68.42], [456.98, 201.9]],
    label: [101, 86],
    holes: [3],
  },
  { area: 3, points: [[337.83, 247.08], [167.78, 273.52], [147.59, 125.29], [325.98, 134.45]], label: [240, 194] },
  // From "Immersive Space Projection Outlines_03.svg": panel 4 now reaches further down.
  { area: 4, points: [[630.26, 288.12], [510.42, 305.44], [449.93, 208.82], [569.98, 204.08]], label: [537, 246], small: true },
  {
    area: 5,
    points: [[900.75, 256.57], [616.5, 259.8], [572.09, 197.62], [463.7, 200.85], [459.84, 65.99], [899.13, 67.61]],
    label: [502, 107],
    holes: [6],
  },
  { area: 6, points: [[811.11, 256.57], [719.4, 256.78], [715.08, 123.67], [808.32, 123.67]], label: [766, 182] },
  { area: 7, points: [[1024.97, 382.35], [909.1, 381.82], [909.1, 49.84], [1023.89, 50.37]], label: [965, 183] },
  {
    area: 8,
    points: [[1275.65, 257.49], [1033.32, 257.15], [1033.32, 69.02], [1283.59, 70.09]],
    label: [1073, 114],
    holes: [9],
  },
  { area: 9, points: [[1114.74, 130.6], [1237.48, 130.6], [1237.48, 219.43], [1114.74, 219.43]], label: [1173, 175] },
  {
    area: 10,
    points: [
      [1534.51, 338.48], [1406.11, 297.8], [1455.68, 224.99], [1380.45, 209.74],
      [1339.17, 272.57], [1282.8, 257.49], [1290.74, 68.5], [1563.89, 2.6],
    ],
    label: [1416, 122],
  },
  { area: 11, points: [[1398.83, 295.72], [1344.55, 277.8], [1383.57, 218.75], [1441.82, 230.89]], label: [1389, 254], small: true },
  // Zone 1 (projector 5): the faces as its SVG draws them, moved into the shared space. The panels (14, 17)
  // are not the SVGs' tracings: they sit where Kantan Mapper's own shapes put them on their walls (zone 1:
  // 5.6 in from the wall's left, 14.94 in from its top, 48.84 x 27.41 in; zone 3: 7.15 in, 8.6 in, 30.47 in
  // wide, down to the floor), drawn through the wall's outline so they stay in perspective
  // (Flora Renders/_scripts/kantan_hole.py, panel_outlines.py).
  { area: 12, points: [[3050.2, 51.64], [3523.06, 158.09], [3525.3, 437.1], [3068.13, 544.67]], label: [3317, 283], inches: [94, 61] }, // left wall
  { area: 13, points: [[3532.03, 158.09], [3963.43, 96.46], [3955.59, 498.73], [3534.27, 438.22]], label: [3870, 281], holes: [14], inches: [80.5, 59] }, // right wall, around the panel
  { area: 14, points: [[3553.79, 228.52], [3786.52, 212.41], [3785.17, 376.27], [3554.67, 361.53]], label: [3670, 295], inches: [48, 27] }, // the panel on the right wall
  // Zone 3 (projector 6): the faces as its SVG draws them, moved into the shared space.
  { area: 15, points: [[6372.96, 199.04], [7061.95, 50.15], [7057.57, 615.06], [6375.88, 486.61]], label: [6687, 324], inches: [100, 47] }, // right wall
  { area: 16, points: [[6049.98, 143.57], [6361.28, 199.04], [6365.66, 485.23], [6317.92, 493.74], [6314.56, 244.38], [6112.37, 221.09], [6114.12, 530.04], [6051.27, 541.24]], label: [6081, 203], small: true, corners: [[6049.98, 143.57], [6361.28, 199.04], [6365.66, 485.23], [6051.27, 541.24]], inches: [47, 48] }, // left wall, around the panel
  { area: 17, points: [[6112.37, 221.09], [6314.56, 244.38], [6317.92, 493.74], [6114.12, 530.04]], label: [6215, 372], inches: [30, 40] }, // the panel on the left wall
];
