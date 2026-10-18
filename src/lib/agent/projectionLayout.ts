/**
 * The room as seen from the front, from "Immersive Room Projection
 * Outlines_02.svg": the room drawing itself (public/room/projection-room.svg,
 * without its outlines and numbers) and, drawn over it, the 11 projection
 * areas — each outline exactly as in that file (its coordinates), with its
 * number where the file puts it.
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
};

export const LAYOUT_SIZE = { width: 1566.13, height: 679.46 } as const;
export const ROOM_DRAWING = '/room/projection-room.svg';

export const PROJECTION_SHAPES: ProjectionShape[] = [
  { area: 1, points: [[78.59, 413.8], [31.5, 427.58], [7.38, 281.7], [59.06, 277.11]], label: [37, 342], filled: true },
  {
    area: 2,
    points: [[436.46, 203.43], [439.68, 266.21], [84.33, 342.58], [47.58, 31.3], [452.58, 68.42], [456.98, 201.9]],
    label: [101, 86],
  },
  { area: 3, points: [[337.83, 247.08], [167.78, 273.52], [147.59, 125.29], [325.98, 134.45]], label: [240, 194] },
  { area: 4, points: [[591.8, 237.87], [472.57, 244.93], [449.93, 208.82], [569.98, 204.08]], label: [518, 224], small: true },
  {
    area: 5,
    points: [[900.75, 256.57], [616.5, 259.8], [572.09, 197.62], [463.7, 200.85], [459.84, 65.99], [899.13, 67.61]],
    label: [502, 107],
  },
  { area: 6, points: [[811.11, 256.57], [719.4, 256.78], [715.08, 123.67], [808.32, 123.67]], label: [766, 182] },
  { area: 7, points: [[1024.97, 382.35], [909.1, 381.82], [909.1, 49.84], [1023.89, 50.37]], label: [965, 183] },
  { area: 8, points: [[1275.65, 257.49], [1033.32, 257.15], [1033.32, 69.02], [1283.59, 70.09]], label: [1073, 114] },
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
];
