// Shared "PLAYBOOK <code>: <label>" parsing — the same pattern figjam-plugin/
// code.js uses to find playbook titles on the board, and sync-figma/route.ts
// uses to read them back over the REST API. Detect Blue Buttons' vision pass
// reads this same printed text off the PNG, so it needs to strip the
// "PLAYBOOK <code>:" prefix the same way before comparing against real
// synced labels — otherwise "PLAYBOOK 1: WELCOME" never matches "WELCOME".
export const TITLE_PATTERN = /^PLAYBOOK\s+([0-9A-Za-z]+)\s*:\s*(.+)$/i;

export function parsePlaybookTitle(raw: string): { code: string; label: string } | null {
  const match = TITLE_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { code: match[1], label: match[2].trim() };
}
