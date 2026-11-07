import type { ClipboardEvent, DragEvent } from 'react';

/**
 * For API key fields: a key can be pasted in, but never copied, cut or dragged back out
 * (spread onto the <input>, which should also be type="password").
 */
const block = (e: ClipboardEvent | DragEvent) => e.preventDefault();

export const noCopy = {
  onCopy: block,
  onCut: block,
  onDragStart: block,
  spellCheck: false,
} as const;
