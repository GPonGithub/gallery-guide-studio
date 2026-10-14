import { sortStages } from './flow';
import { type AgentFlow, type Cue, type CueTrigger, type Exit, type Slot, type Stage, type Steering } from './types';

/**
 * The FigJam side of a flow: every stage (and the master settings) is a
 * two-column table — a header row (STAGE | "3A: MAKE AN APPOINTMENT"),
 * then one row per field. These two functions are the only place that
 * format is defined, so drawing a board and importing it back always agree.
 * Matches the "Goal Agent Template" board (see its GUIDE card).
 */

export type BoardCard = {
  kind: 'MASTER' | 'GUIDE' | 'KNOWLEDGE' | 'STAGE';
  title: string;
  rows: [string, string][];
  /** 'top' = master/guide row above the flow; 'flow' = stage columns. */
  area: 'top' | 'flow';
  column: number;
  header: 'black' | 'darkGray';
  labels: 'lightGray' | 'lightBlue' | 'lightYellow' | 'lightGreen';
};

export type BoardLink = { from: number; to: number; label: string };

export type BoardSpec = { title: string; intro: string; cards: BoardCard[]; links: BoardLink[] };

/** What the plugin reads back: every table on the page, as rows of [left cell, right cell]. */
export type ReadTable = { id: string; rows: [string, string][] };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function slotLine(s: Slot): string {
  return `${s.name}${s.required ? '*' : ''} — ${s.description}`;
}

// "goal met" is already said by the exit itself — don't repeat it as the note.
const stripGoalMet = (s: string) => s.trim().replace(/^(?:the\s+)?goal(?:\s+is)?\s+met\b[\s—–:,.-]*/i, '').trim();

function exitLine(e: Exit): string {
  const note = stripGoalMet(e.when);
  if (e.onComplete) return `→ ${e.to} when goal met${note ? ` — ${note}` : ''}`;
  return `→ ${e.to} when ${e.when.trim()}`;
}

function cueLine(c: Cue): string {
  switch (c.on) {
    case 'enter':
      return `${c.name} on enter`;
    case 'complete':
      return `${c.name} on goal met`;
    case 'exit':
      return `${c.name} on exit`;
    case 'slot':
      return `${c.name} on ${c.slot ?? ''}`;
    case 'moment':
      return `${c.name} when ${c.when ?? ''}`;
  }
}

export const GUIDE_ROWS: [string, string][] = [
  ['Header row', 'STAGE  |  CODE: NAME   e.g. 3A: MAKE AN APPOINTMENT\nThe lowest code is where every call starts (1 before 2A before 2B…).'],
  ['Goal', 'One sentence: what this stage must achieve.'],
  ['Collect', "One item per line:  name — description\nAdd * after the name if it is required, e.g.\npatient_name* — the caller's full name"],
  ['Instructions', 'How the agent should approach it, in plain English.'],
  ['Steering', 'Strict, Balanced or Relaxed — how firmly to pull an off-topic caller back.'],
  [
    'Exits',
    'One per line:  → CODE when <condition>\n→ CODE when goal met   moves on automatically once everything is collected.\nUse END instead of a code to finish the call.',
  ],
  [
    'TD cues',
    'One per line, sent to TouchDesigner:\nCUE_NAME on enter  ·  on goal met  ·  on exit  ·  on <information name>\nCUE_NAME when <a moment, in plain English>',
  ],
  ['Arrows', 'Connectors between cards are only for the picture — the Exits row is what the agent follows.'],
  [
    'Knowledge',
    'The KNOWLEDGE card holds facts the bot can use but must never invent: names, times, prices, options. Write them any way you like.',
  ],
  ['New stage', 'Duplicate any STAGE card (⌘D / Ctrl+D) and edit it, then Import from FigJam in the app.'],
];

export function flowToBoard(flow: AgentFlow): BoardSpec {
  const cards: BoardCard[] = [
    {
      kind: 'MASTER',
      title: flow.name?.trim() || 'Conversation',
      area: 'top',
      column: 0,
      header: 'black',
      labels: 'lightBlue',
      rows: [
        ['Persona', flow.persona],
        ['Rules', flow.rules],
        ['Exits from any stage', flow.globalExits.map(exitLine).join('\n')],
        ['TD cues', flow.globalCues.map(cueLine).join('\n')],
        ['TouchDesigner address', flow.tdUrl],
      ],
    },
    { kind: 'GUIDE', title: 'How to write each row', area: 'top', column: 1, header: 'darkGray', labels: 'lightYellow', rows: GUIDE_ROWS },
    {
      kind: 'KNOWLEDGE',
      title: 'Facts the bot can use',
      area: 'top',
      column: 2,
      header: 'black',
      labels: 'lightGreen',
      rows: [['Facts', flow.knowledge?.trim() ?? '']],
    },
  ];

  // One column per code number (1 | 2A 2B | 3A 3B 3C …) so the board reads left to right.
  const ordered = sortStages(flow.stages);
  const numbers = [...new Set(ordered.map((s) => /^\d+/.exec(s.code)?.[0] ?? '∞'))];
  const indexOfStage = new Map<string, number>();
  for (const stage of ordered) {
    indexOfStage.set(stage.code, cards.length);
    cards.push({
      kind: 'STAGE',
      title: `${stage.code}: ${stage.name}`,
      area: 'flow',
      column: numbers.indexOf(/^\d+/.exec(stage.code)?.[0] ?? '∞'),
      header: 'black',
      labels: 'lightGray',
      rows: [
        ['Goal', stage.goal],
        ['Collect', stage.collect.map(slotLine).join('\n')],
        ['Instructions', stage.instructions],
        ['Steering', capitalize(stage.steering)],
        ['Exits', stage.exits.map(exitLine).join('\n')],
        ['TD cues', stage.cues.map(cueLine).join('\n')],
      ],
    });
  }

  const links: BoardLink[] = [];
  for (const stage of ordered) {
    for (const exit of stage.exits) {
      const to = indexOfStage.get(exit.to);
      if (to === undefined) continue;
      links.push({ from: indexOfStage.get(stage.code)!, to, label: exit.onComplete ? 'goal met' : shorten(exit.when) });
    }
  }
  for (const exit of flow.globalExits) {
    const to = indexOfStage.get(exit.to);
    if (to !== undefined) links.push({ from: 0, to, label: `from any stage: ${shorten(exit.when, 30)}` });
  }

  return {
    title: `${flow.name?.trim() || 'Goal Agent'} — Conversation Flow`,
    intro:
      'Each STAGE table is one part of the conversation: a goal, the information it needs, and where it can go next. ' +
      'The agent talks freely to reach each goal and steers callers back when they wander. Edit anything here, then ' +
      'click Import from FigJam in Goal Agent Studio to test it. The GUIDE card explains how to write each row.',
    cards,
    links,
  };
}

// --- reading a board back ------------------------------------------------------

const lines = (cell: string) =>
  cell
    .split(/\r?\n|\u2028/)
    .map((l) => l.trim())
    .filter(Boolean);

const toSlotName = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

function parseSlot(line: string): Slot | null {
  const match = /^([A-Za-z0-9_ ]+?)\s*(\*)?\s*(?:[—–]|-{1,2}|:)\s*(.*)$/.exec(line);
  const name = toSlotName(match ? match[1] : line.replace(/\*$/, ''));
  if (!name) return null;
  return { name, required: match ? Boolean(match[2]) : line.trim().endsWith('*'), description: match?.[3].trim() || name.replace(/_/g, ' ') };
}

function parseExit(line: string): Exit | null {
  const match = /^(?:→|->|=>|>)?\s*([0-9]+[A-Za-z]*|END)\b\s*(.*)$/i.exec(line);
  if (!match) return null;
  const to = match[1].toUpperCase();
  const rest = match[2].replace(/^when\s+/i, '').trim();
  const auto = /^(?:the\s+)?goal(?:\s+is)?\s+met\b\s*(?:[—–-]+\s*)?(.*)$/i.exec(rest);
  if (auto) return { to, onComplete: true, when: auto[1].trim() };
  return { to, onComplete: false, when: rest };
}

function parseCue(line: string): Cue | null {
  const match = /^([A-Za-z0-9_]+)\s+(on|when)\s+(.+)$/i.exec(line);
  if (!match) return null;
  const name = match[1].toUpperCase();
  const target = match[3].trim();
  if (match[2].toLowerCase() === 'when') return { name, on: 'moment', when: target };
  const key = target.toLowerCase();
  const trigger: CueTrigger | null =
    /^enter(ing)?$/.test(key) ? 'enter' : /^(goal met|complete|completed|done)$/.test(key) ? 'complete' : /^(exit|leaving|leave)$/.test(key) ? 'exit' : null;
  return trigger ? { name, on: trigger } : { name, on: 'slot', slot: toSlotName(target) };
}

function parseSteering(cell: string): Steering {
  const key = cell.trim().toLowerCase();
  return key.startsWith('strict') ? 'strict' : key.startsWith('relax') ? 'relaxed' : 'balanced';
}

const normaliseLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

function parseList<T>(cell: string, parse: (line: string) => T | null, what: string, where: string, warnings: string[]): T[] {
  const out: T[] = [];
  for (const line of lines(cell)) {
    const parsed = parse(line);
    if (parsed) out.push(parsed);
    else warnings.push(`${where}: couldn't read ${what} "${line}"`);
  }
  return out;
}

export function boardToFlow(
  tables: ReadTable[],
  keep: { tdUrl?: string; tdTiming?: AgentFlow['tdTiming']; knowledge?: string } = {},
): { flow: AgentFlow; warnings: string[] } {
  const warnings: string[] = [];
  // The knowledge base isn't on the board — keep the app's copy.
  const flow: AgentFlow = {
    name: '',
    persona: '',
    rules: '',
    globalExits: [],
    globalCues: [],
    stages: [],
    tdUrl: keep.tdUrl ?? '',
    tdTiming: keep.tdTiming,
    knowledge: keep.knowledge ?? '',
  };
  let sawMaster = false;
  let sawKnowledge = false;

  for (const table of tables) {
    const [header, ...body] = table.rows;
    if (!header) continue;
    const kind = header[0].trim().toUpperCase();
    const field = (label: string) => body.find(([l]) => normaliseLabel(l) === label)?.[1] ?? '';

    if (kind === 'MASTER') {
      if (sawMaster) warnings.push('More than one MASTER card — using the first.');
      if (sawMaster) continue;
      sawMaster = true;
      flow.name = header[1].trim();
      flow.persona = field('persona').trim();
      flow.rules = field('rules').trim();
      flow.globalExits = parseList(field('exits from any stage'), parseExit, 'exit', 'MASTER', warnings).map((e) => ({ ...e, onComplete: false }));
      flow.globalCues = parseList(field('td cues'), parseCue, 'cue', 'MASTER', warnings);
      const address = field('touchdesigner address').trim();
      if (address) flow.tdUrl = address;
    } else if (kind === 'KNOWLEDGE') {
      // The board is the source of truth: a KNOWLEDGE card replaces the app's
      // copy (even if emptied). Every row's text counts, in case students
      // split it into several rows.
      if (sawKnowledge) {
        warnings.push('More than one KNOWLEDGE card — using the first.');
        continue;
      }
      sawKnowledge = true;
      flow.knowledge = body
        .map(([label, value]) => (/^facts$/i.test(label.trim()) || !label.trim() ? value : `${label.trim()}: ${value}`).trim())
        .filter(Boolean)
        .join('\n\n');
    } else if (kind === 'STAGE') {
      const title = /^\s*([0-9]+[A-Za-z]*)\s*[:.\-–—]\s*(.+)$/.exec(header[1]);
      if (!title) {
        warnings.push(`A STAGE card's title "${header[1].trim()}" isn't in the form "CODE: NAME" — skipped.`);
        continue;
      }
      const code = title[1].toUpperCase();
      const where = `Stage ${code}`;
      const stage: Stage = {
        id: `figjam-${table.id}`,
        code,
        name: title[2].trim(),
        goal: field('goal').trim(),
        collect: parseList(field('collect'), parseSlot, 'information line', where, warnings),
        instructions: field('instructions').trim(),
        steering: parseSteering(field('steering')),
        exits: parseList(field('exits'), parseExit, 'exit', where, warnings),
        cues: parseList(field('td cues'), parseCue, 'cue', where, warnings),
      };
      if (flow.stages.some((s) => s.code === code)) {
        warnings.push(`Two STAGE cards use code ${code} — keeping the first.`);
        continue;
      }
      flow.stages.push(stage);
    }
  }

  if (!sawMaster) warnings.push('No MASTER card found — persona and rules are empty.');
  return { flow, warnings };
}
