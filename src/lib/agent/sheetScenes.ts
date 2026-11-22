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
 *          saved; the app shows it (Design Process, section 5) and doesn't read it
 *   row 8  Media actions in this scene — one per line (e.g. "Show picture of
 *          Maya when the nurse asks to see it"); media is connected to them in
 *          the Media Library
 *   row 9  Media in this scene — for the student; the app doesn't read it
 *   row 10 Persona — the character who speaks in this scene, in the student's
 *          own words. Each scene has its own: the "All scenes" column's is ignored
 *   row 11 People in this scene — the people the agent talks with, one per line,
 *          "Name: role" (e.g. "Dave: The nurse"). Dual microphones puts the first on
 *          the left microphone and the second on the right
 *   row 12 Jump to another scene — one per line, in the student's own words, naming the
 *          scene anywhere: "When the patient says "I feel like I'm dying," jump to scene 4".
 *          When the caller says something like it, the conversation goes straight to that
 *          scene instead of carrying on here (see readJumps)
 *
 * Whatever the "All scenes" column says in rows 3–6, 8 and 12 is given to every scene,
 * ahead of the scene's own. A column with nothing in rows 2–6 is skipped, and
 * so is anything past the 20th scene column, counting the empty ones: students
 * can keep notes there.
 * Scene numbers are kept exactly as the sheet gives them, gaps and all.
 */

export const FIRST_SCENE_COLUMN = 'B';
export const LAST_SCENE_COLUMN = 'Z';
const MAX_SCENES = 20;
const ROW = { number: 1, name: 2, describe: 3, knowledge: 4, save: 5, cannotUse: 6, mediaActions: 8, persona: 10, people: 11, jumps: 12 } as const;
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
  /** Media actions (row 8), one per line — the "All scenes" ones first. */
  mediaActions: string[];
  /** Persona (row 10): this scene's own, word for word. */
  persona: string;
  /** People in this scene (row 11): who the agent talks with, in order (Dual microphones: left, then right). */
  people: { name: string; role: string }[];
  /** Jump to another scene (row 12): which scene, and when — the "All scenes" ones first, never to itself. */
  jumps: { scene: string; when: string }[];
  /** Row 12 lines that name no scene to go to — they do nothing, and the studio says so. */
  jumpsSkipped: string[];
};

/** Row 11's lines, "Name: role" (or "Name - role", or just a name) — in order. */
export function peopleLines(text: string): { name: string; role: string }[] {
  return actionLines(text)
    .map((line) => {
      const m = /^(.+?)\s*(?::|\s[-–—]\s|\|)\s*(.*)$/.exec(line);
      const name = (m ? m[1] : line).trim();
      const role = (m ? m[2] : '').replace(/^(the|a|an)\s+/i, '').trim();
      return { name, role };
    })
    .filter((p) => p.name && p.name.length <= 60);
}

/**
 * Row 12's lines, written however a student would: "Scene 4: when …", "When the patient says, "I feel like I'm
 * dying," jump to scene 4", "If they faint → scene 5", "4 - they ask for a nurse". The scene is found anywhere
 * in the line ("scene 4", or a number at the start); the rest, with "jump/go to scene 4" taken out, is when.
 * A line naming no scene is kept in `skipped`, so the studio can say why it does nothing.
 */
const JUMP_WORDS =
  /\s*[,;:—–-]?\s*(?:and\s+)?(?:then\s+)?(?:(?:please\s+)?(?:jump|go|move|switch|skip|cut|change|head|transition|take\s+(?:them|him|her|the\s+\w+)|send\s+(?:them|him|her|the\s+\w+))\s+(?:straight\s+|directly\s+|right\s+|immediately\s+)?(?:on\s+|over\s+|ahead\s+)?(?:to|into)\s+|(?:→|->|=>)\s*)?scene\s*(\d+[A-Za-z]?)\b\s*[:.,;—–-]?\s*/i;
const LEADING_NUMBER = /^(\d+[A-Za-z]?)\b\s*(?::|[-–—]|\||→|->|=>)?\s*/;

export function readJumps(text: string): { jumps: { scene: string; when: string }[]; skipped: string[] } {
  const jumps: { scene: string; when: string }[] = [];
  const skipped: string[] = [];
  for (const line of actionLines(text)) {
    const named = JUMP_WORDS.exec(line);
    const numbered = named ? null : LEADING_NUMBER.exec(line);
    const scene = named?.[1] ?? numbered?.[1];
    const rest = named ? `${line.slice(0, named.index)} ${line.slice(named.index + named[0].length)}` : line.slice(numbered?.[0].length ?? 0);
    const when = rest
      .replace(/\s+/g, ' ')
      .replace(/^[\s,;:.—–-]+|[\s,;:—–-]+$/g, '')
      .replace(/^(?:when|whenever|if|once)\s+/i, '')
      .trim();
    if (scene && when) jumps.push({ scene: scene.toUpperCase(), when });
    else skipped.push(line);
  }
  return { jumps, skipped };
}

/** Row 12's jumps (see readJumps). */
export const jumpLines = (text: string) => readJumps(text).jumps;

/** A cell's lines, each one action — blank lines and leading bullets ("-", "•", "1.") dropped. */
export const actionLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

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
  const sharedActions: string[] = [];
  const sharedJumps: { scene: string; when: string }[] = [];
  const sceneColumns: number[] = [];
  let place = 0;
  for (let col = first; col <= last; col++) {
    if (SHARED_COLUMN.test(cell(ROW.number, col))) {
      for (const r of contentRows) if (cell(r, col)) shared.get(r)!.push(cell(r, col));
      sharedActions.push(...actionLines(cell(ROW.mediaActions, col)));
      sharedJumps.push(...jumpLines(cell(ROW.jumps, col)));
    } else if (++place <= MAX_SCENES && [ROW.name, ...contentRows].some((r) => cell(r, col))) {
      sceneColumns.push(col);
    }
  }
  const withShared = (row: (typeof contentRows)[number], col: number) =>
    [...shared.get(row)!, cell(row, col)].filter(Boolean).join('\n\n');

  return sceneColumns.map((col, i) => {
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
      mediaActions: [...sharedActions, ...actionLines(cell(ROW.mediaActions, col))],
      persona: cell(ROW.persona, col),
      people: peopleLines(cell(ROW.people, col)),
      jumps: [...sharedJumps, ...jumpLines(cell(ROW.jumps, col))].filter((j) => j.scene !== number.toUpperCase()),
      jumpsSkipped: readJumps(cell(ROW.jumps, col)).skipped,
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
