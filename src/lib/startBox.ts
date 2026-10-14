import type { PlaybookBox } from './types';

/**
 * RULE: a conversation starts at the first playbook in the flow — the one
 * with the lowest playbook code ("1" before "2A" before "2B" before "3A"),
 * read from its FigJam title "PLAYBOOK <code>: <label>". Never "whichever
 * blue button Detect happened to find first": detection order follows the
 * picture's layout, not the conversation's.
 *
 * Boxes without a parseable code sort after every coded one, keeping their
 * existing order, so a flow with no codes at all still starts at its first box.
 */
function parseCode(code: string): [number, string] | null {
  const match = /^(\d+)([A-Za-z]*)$/.exec(code.trim());
  return match ? [Number(match[1]), match[2].toUpperCase()] : null;
}

export function compareByCode(a: PlaybookBox, b: PlaybookBox): number {
  const ca = parseCode(a.code ?? '');
  const cb = parseCode(b.code ?? '');
  if (!ca || !cb) return ca ? -1 : cb ? 1 : 0;
  return ca[0] - cb[0] || ca[1].localeCompare(cb[1]);
}

export function sortByCode(boxes: PlaybookBox[]): PlaybookBox[] {
  return [...boxes].sort(compareByCode);
}

export function getStartBox(boxes: PlaybookBox[]): PlaybookBox | null {
  return sortByCode(boxes)[0] ?? null;
}
