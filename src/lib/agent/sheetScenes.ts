/**
 * Scenes from a Google Sheet. Column A holds the row labels; every column
 * after it is either a scene or the shared "All scenes" column. Each is laid
 * out the same way:
 *
 *   row 1  the scene's number (e.g. "Scene 4" or just "4"; if there's no
 *          number there, its place among the scene columns stands in) —
 *          or "All scenes" for the shared column
 *   row 2  its name
 *   row 3  Describe the conversation
 *   row 4  Knowledge base (information that can be used)
 *   row 5  Information saved from this scene (to collect, and keep for later scenes)
 *   row 6  Information this scene cannot use
 *   row 7  List of saved information from this scene — what the conversations
 *          saved; the app shows it (Design Process, section 4) and doesn't read it
 *
 * Whatever the "All scenes" column says in rows 3–6 is given to every scene,
 * ahead of the scene's own. A column with nothing in rows 2–6 is skipped.
 * Scene numbers are kept exactly as the sheet gives them, gaps and all.
 */

export const FIRST_SCENE_COLUMN = 'B';
export const LAST_SCENE_COLUMN = 'Z';
const MAX_SCENES = 20;
const ROW = { number: 1, name: 2, describe: 3, knowledge: 4, save: 5, cannotUse: 6 } as const;
const SHARED_COLUMN = /\ball\s*scenes\b/i;

/** One scene as read from the sheet. */
export type SheetScene = {
  /** The sheet column it came from (B–Z). */
  column: string;
  /** As written in the sheet (not renumbered) — its lasting link to the sheet. */
  number: string;
  name: string;
  /** Describe the conversation (row 3), after the "All scenes" description. */
  description: string;
  /** Knowledge base (row 4), after the "All scenes" knowledge base. */
  knowledge: string;
  /** Information to save from the scene, for later scenes (row 5). */
  saveInfo: string;
  /** Information this scene cannot use (row 6). */
  cannotUse: string;
};

/** The sheet's id and tab (gid) from a pasted link, or null if it isn't a Google Sheets link. */
export function parseSheetUrl(url: string): { sheetId: string; gid: string } | null {
  const match = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url.trim());
  if (!match) return null;
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1] ?? '0';
  return { sheetId: match[1], gid };
}

/** CSV (as Google exports it) to rows of cells: quoted cells, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const columnLetter = (index: number) => String.fromCharCode('A'.charCodeAt(0) + index);

/** The scenes in a sheet's rows (as parsed from CSV, row 1 first); see the layout at the top. */
export function mapSheetScenes(grid: string[][]): SheetScene[] {
  const cell = (row: number, col: number) => (grid[row - 1]?.[col] ?? '').trim();
  const first = FIRST_SCENE_COLUMN.charCodeAt(0) - 'A'.charCodeAt(0);
  const last = LAST_SCENE_COLUMN.charCodeAt(0) - 'A'.charCodeAt(0);
  const contentRows = [ROW.describe, ROW.knowledge, ROW.save, ROW.cannotUse] as const;

  // The "All scenes" column(s): given to every scene.
  const shared = new Map<number, string[]>(contentRows.map((r) => [r, []]));
  const sceneColumns: number[] = [];
  for (let col = first; col <= last; col++) {
    if (SHARED_COLUMN.test(cell(ROW.number, col))) {
      for (const r of contentRows) if (cell(r, col)) shared.get(r)!.push(cell(r, col));
    } else if ([ROW.name, ...contentRows].some((r) => cell(r, col))) {
      sceneColumns.push(col);
    }
  }
  const withShared = (row: (typeof contentRows)[number], col: number) =>
    [...shared.get(row)!, cell(row, col)].filter(Boolean).join('\n\n');

  return sceneColumns.slice(0, MAX_SCENES).map((col, i) => {
    // "Scene 4", "SCENE 12B", "4" → "4", "12B"; anything else → its place among the scenes.
    const number = /\d+[A-Za-z]?/.exec(cell(ROW.number, col))?.[0] ?? String(i + 1);
    return {
      column: columnLetter(col),
      number,
      name: cell(ROW.name, col) || `Scene ${number}`,
      description: withShared(ROW.describe, col),
      knowledge: withShared(ROW.knowledge, col),
      saveInfo: withShared(ROW.save, col),
      cannotUse: withShared(ROW.cannotUse, col),
    };
  });
}

/** A short fingerprint of a flow — to tell whether what's on FigJam is the current version. */
export function flowFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Orders scene numbers as people expect: 2 before 10, numbers before words. */
export function compareSceneNumbers(a: string, b: string): number {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  if (!Number.isNaN(na) !== !Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true });
}
