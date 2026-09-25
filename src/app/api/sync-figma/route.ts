import type { PlaybookBox, PlaybookStep, StepOption } from '@/lib/types';
import { parseFigmaUrl } from '@/lib/figmaUrl';
import { TITLE_PATTERN } from '@/lib/playbookTitle';

export const maxDuration = 30;

const BUTTON_TEXT_PATTERN = /^open playbook editor$/i;
// STEP / BOT·USER·NAV / INSTRUCTION / VARIABLE / Send to TD / Save data to
// sheet / Designer ID — the fixed column layout every table in this project
// uses, whether hand-built, plugin-built, or app-built.
const COLUMN_COUNT = 7;
const VALID_OPTIONS: StepOption[] = ['BOT', 'USER', 'NAV'];

type FigmaEndpoint = { endpointNodeId?: string } | string | null | undefined;
type BoundingBox = { x: number; y: number; width: number; height: number };

type FigmaNode = {
  id: string;
  type?: string;
  absoluteBoundingBox?: BoundingBox | null;
  children?: FigmaNode[];
  characters?: string;
  text?: { characters?: string } | string;
  connectorStart?: FigmaEndpoint;
  connectorEnd?: FigmaEndpoint;
  rowIndex?: number;
  columnIndex?: number;
};

function collectNodes(node: FigmaNode, out: FigmaNode[]) {
  out.push(node);
  for (const child of node.children ?? []) collectNodes(child, out);
}

function getText(node: FigmaNode): string {
  if (typeof node.characters === 'string') return node.characters;
  if (typeof node.text === 'string') return node.text;
  if (node.text && typeof node.text === 'object' && typeof node.text.characters === 'string') {
    return node.text.characters;
  }
  return '';
}

function getEndpointId(endpoint: FigmaEndpoint): string | null {
  if (typeof endpoint === 'string') return endpoint;
  if (endpoint && typeof endpoint === 'object' && typeof endpoint.endpointNodeId === 'string') {
    return endpoint.endpointNodeId;
  }
  return null;
}

// Group a TABLE node's TABLE_CELL children into rows of COLUMN_COUNT cells.
// Prefers explicit row/column index fields when present; otherwise falls
// back to the cells' natural append order, which is row-major for every
// table this project ever builds (by hand, by the FigJam plugin, or here).
// NOTE: the exact REST shape for a table cell's position wasn't verified
// against a live API response while building this (no personal access
// token available in that environment) — only that TableNode/TableCellNode
// with cell `characters` are real, documented types. If real-world tables
// come back oddly grouped, check here first.
function groupTableRows(table: FigmaNode): string[][] {
  const cells = table.children ?? [];
  const hasIndices = cells.length > 0 && cells.every((c) => typeof c.rowIndex === 'number' && typeof c.columnIndex === 'number');
  if (hasIndices) {
    const maxRow = Math.max(...cells.map((c) => c.rowIndex as number));
    const rows: string[][] = Array.from({ length: maxRow + 1 }, () => Array(COLUMN_COUNT).fill(''));
    for (const c of cells) {
      const r = c.rowIndex as number;
      const col = c.columnIndex as number;
      if (col < COLUMN_COUNT) rows[r][col] = getText(c).trim();
    }
    return rows;
  }
  const rows: string[][] = [];
  for (let i = 0; i < cells.length; i += COLUMN_COUNT) {
    rows.push(cells.slice(i, i + COLUMN_COUNT).map((c) => getText(c).trim()));
  }
  return rows;
}

// Row 0 is the header row ("STEP", "BOT / USER /NAV", ...) — skip it.
// Trailing blank rows (no option set) are dropped, not kept as empty steps.
function parseSteps(rows: string[][]): PlaybookStep[] {
  const steps: PlaybookStep[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const option = row[1]?.trim().toUpperCase();
    if (!option || !VALID_OPTIONS.includes(option as StepOption)) continue;
    steps.push({
      id: crypto.randomUUID(),
      option: option as StepOption,
      instruction: (row[2] ?? '').trim(),
      variable: row[3]?.trim() || undefined,
    });
  }
  return steps;
}

// NAV instructions are prose ("go to Playbook 2A"), not a bound reference —
// resolve by matching a known playbook code mentioned in the text. Longest
// code first so "2A" isn't shadowed by a bare "2".
function resolveNavTargets(steps: PlaybookStep[], codeToId: Map<string, string>) {
  const codes = [...codeToId.keys()].sort((a, b) => b.length - a.length);
  for (const step of steps) {
    if (step.option !== 'NAV') continue;
    for (const code of codes) {
      if (new RegExp(`\\bplaybook\\s+${code}\\b`, 'i').test(step.instruction)) {
        step.navTarget = codeToId.get(code);
        break;
      }
    }
  }
}

function findBackground(shapes: FigmaNode[], titleBox: BoundingBox, tableBox: BoundingBox): FigmaNode | undefined {
  const candidates = shapes.filter((s) => {
    if (getText(s).trim()) return false; // the background is the one empty-text shape
    const box = s.absoluteBoundingBox;
    if (!box) return false;
    return (
      box.x <= titleBox.x + 5 &&
      box.x > titleBox.x - 40 &&
      box.y <= titleBox.y + 5 &&
      box.y > titleBox.y - 60 &&
      box.width > tableBox.width
    );
  });
  candidates.sort((a, b) => (b.absoluteBoundingBox?.width ?? 0) - (a.absoluteBoundingBox?.width ?? 0));
  return candidates[0];
}

export async function POST(req: Request) {
  try {
    const { fileUrl, figmaApiKey } = (await req.json()) as { fileUrl?: string; figmaApiKey?: string };
    if (!figmaApiKey?.trim()) {
      return Response.json({ error: 'Add a Figma personal access token under "API keys" first.' }, { status: 400 });
    }
    const parsed = fileUrl ? parseFigmaUrl(fileUrl) : null;
    if (!parsed) {
      return Response.json({ error: "Couldn't recognize that as a Figma board URL." }, { status: 400 });
    }

    const res = await fetch(
      `https://api.figma.com/v1/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`,
      { headers: { 'X-Figma-Token': figmaApiKey } },
    );
    if (!res.ok) {
      const body = await res.text();
      return Response.json({ error: `Figma API error (${res.status}): ${body.slice(0, 300)}` }, { status: 502 });
    }
    const data = (await res.json()) as { nodes?: Record<string, { document?: FigmaNode }> };
    const entry = data.nodes?.[parsed.nodeId] ?? Object.values(data.nodes ?? {})[0];
    const root = entry?.document;
    if (!root) {
      return Response.json({ error: 'Figma returned no content for that board/node.' }, { status: 502 });
    }

    const allNodes: FigmaNode[] = [];
    collectNodes(root, allNodes);

    const titles = allNodes.filter((n) => n.type === 'TEXT' && TITLE_PATTERN.test(getText(n).trim()) && n.absoluteBoundingBox);
    const tables = allNodes.filter((n) => n.type === 'TABLE' && n.absoluteBoundingBox);
    const shapes = allNodes.filter((n) => n.type === 'SHAPE_WITH_TEXT' && n.absoluteBoundingBox);

    if (titles.length === 0) {
      return Response.json(
        { error: 'Couldn’t find any "PLAYBOOK <code>: <label>" titles on that Figma node.' },
        { status: 422 },
      );
    }

    type Parsed = {
      titleId: string;
      tableFigmaId: string;
      bgFigmaId: string | null;
      code: string;
      label: string;
      instructionPrompt: string;
      steps: PlaybookStep[];
      // The whole card's real footprint on the board — the background box
      // when found (best representation: title+panel+table+buttons all
      // sit within it), otherwise approximated from title-to-table extent.
      // Drives real layout positioning below, so the app canvas actually
      // matches how the board was laid out in FigJam.
      rect: BoundingBox;
    };
    const parsedList: Parsed[] = [];

    for (const title of titles) {
      const match = TITLE_PATTERN.exec(getText(title).trim());
      if (!match) continue;
      const code = match[1];
      const label = match[2].trim();
      const titleBox = title.absoluteBoundingBox as BoundingBox;

      const nearTables = tables
        .filter((t) => {
          const box = t.absoluteBoundingBox as BoundingBox;
          return Math.abs(box.x - titleBox.x) < 40 && box.y > titleBox.y;
        })
        .sort((a, b) => (a.absoluteBoundingBox as BoundingBox).y - (b.absoluteBoundingBox as BoundingBox).y);
      const table = nearTables[0];
      if (!table) continue; // a title with no table below it — nothing to import for this one

      const tableBox = table.absoluteBoundingBox as BoundingBox;
      const nearPanels = shapes
        .filter((s) => {
          const txt = getText(s).trim();
          const box = s.absoluteBoundingBox as BoundingBox;
          return txt && !BUTTON_TEXT_PATTERN.test(txt) && Math.abs(box.x - titleBox.x) < 40 && box.y > titleBox.y && box.y < tableBox.y;
        })
        .sort((a, b) => (a.absoluteBoundingBox as BoundingBox).y - (b.absoluteBoundingBox as BoundingBox).y);
      const panel = nearPanels[0];
      const bg = findBackground(shapes, titleBox, tableBox);
      const bgBox = bg?.absoluteBoundingBox as BoundingBox | undefined;
      // Fallback when a card has no distinct background shape: approximate
      // its footprint by spanning from the title's top-left to the table's
      // bottom-right — not as tidy as a real background box, but still
      // grounded in this card's actual position rather than a guess.
      const rect: BoundingBox = bgBox ?? {
        x: Math.min(titleBox.x, tableBox.x),
        y: titleBox.y,
        width: Math.max(titleBox.width, tableBox.width),
        height: tableBox.y + tableBox.height - titleBox.y,
      };

      parsedList.push({
        titleId: title.id,
        tableFigmaId: table.id,
        bgFigmaId: bg ? bg.id : null,
        code,
        label,
        instructionPrompt: panel ? getText(panel).trim() : '',
        steps: parseSteps(groupTableRows(table)),
        rect,
      });
    }

    if (parsedList.length === 0) {
      return Response.json({ error: 'Found playbook titles, but none had a table underneath to read.' }, { status: 422 });
    }

    const codeToId = new Map<string, string>();
    const bgIdToAppId = new Map<string, string>();
    for (const b of parsedList) {
      const id = crypto.randomUUID();
      codeToId.set(b.code, id);
      if (b.bgFigmaId) bgIdToAppId.set(b.bgFigmaId, id);
    }
    for (const b of parsedList) resolveNavTargets(b.steps, codeToId);

    const connectorEndpoints = allNodes
      .filter((n) => n.type === 'CONNECTOR')
      .map((n) => ({ from: getEndpointId(n.connectorStart), to: getEndpointId(n.connectorEnd) }))
      .filter((c): c is { from: string; to: string } => Boolean(c.from && c.to));

    // Position boxes to match how the board is actually laid out in
    // FigJam, not an abstract grid — each card's x/y/width/height become
    // percentages of the *whole board's* bounding box (every card's `rect`
    // combined), so relative position and spacing survive the trip
    // faithfully. A margin is added around the raw bounds: partly normal
    // breathing room, partly because the app's on-canvas title chip floats
    // above each box and needs clearance from whatever sits above it,
    // including the very top edge.
    const MARGIN_PX = 250;
    const minX = Math.min(...parsedList.map((b) => b.rect.x)) - MARGIN_PX;
    const minY = Math.min(...parsedList.map((b) => b.rect.y)) - MARGIN_PX;
    const maxX = Math.max(...parsedList.map((b) => b.rect.x + b.rect.width)) + MARGIN_PX;
    const maxY = Math.max(...parsedList.map((b) => b.rect.y + b.rect.height)) + MARGIN_PX;
    const boardWidth = maxX - minX;
    const boardHeight = maxY - minY;

    const boxes: PlaybookBox[] = parsedList.map((b) => {
      const appId = codeToId.get(b.code)!;
      const leadsTo = b.bgFigmaId
        ? connectorEndpoints
            .filter((c) => c.from === b.bgFigmaId)
            .map((c) => bgIdToAppId.get(c.to))
            .filter((id): id is string => Boolean(id))
        : undefined;
      return {
        id: appId,
        figmaSourceId: b.tableFigmaId,
        label: b.label,
        code: b.code,
        instructionPrompt: b.instructionPrompt,
        steps: b.steps,
        x: ((b.rect.x - minX) / boardWidth) * 100,
        y: ((b.rect.y - minY) / boardHeight) * 100,
        width: (b.rect.width / boardWidth) * 100,
        height: (b.rect.height / boardHeight) * 100,
        leadsTo,
      };
    });

    // The real pixel size this board's percentages are expressed against —
    // the client renders its canvas at these dimensions (not a fixed
    // constant) so positions land exactly where they were designed, with
    // no stretching/squishing from a mismatched aspect ratio.
    const boardExtent = { width: Math.round(boardWidth), height: Math.round(boardHeight) };

    return Response.json({ boxes, boardExtent });
  } catch (err) {
    console.error('sync-figma failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Sync failed. Check the file URL and token, then try again.' }, { status: 500 });
  }
}
