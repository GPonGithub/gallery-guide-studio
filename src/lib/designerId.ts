// Shared by PlaybookEditorModal, DesignerIdTableModal, and PlaybookCanvas's
// on-box preview — the Designer ID is always computed the same way from
// live state, never stored, so it can't drift out of sync with a step's
// actual position.
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function designerId(initials: string, code: string, stepNumber: number): string {
  return `${initials.trim() || '—'}_${code}_${pad2(stepNumber)}`;
}
