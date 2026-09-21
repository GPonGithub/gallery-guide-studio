/**
 * Shared Minimalist Monochrome building blocks. Centralizing these here
 * means every button/field across the app inverts, borders, and transitions
 * identically — the palette and motion rules only need to change in one
 * place. Compose with template strings for one-off additions (sizing,
 * layout) rather than forking these.
 */

const labelText = 'font-label text-[11px] font-medium uppercase tracking-widest';

export const buttonPrimary =
  `border-2 border-ink bg-ink px-4 py-2 ${labelText} text-paper transition-colors duration-100 ` +
  'hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:border-hair disabled:bg-hair disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

export const buttonOutline =
  `border-2 border-ink bg-paper px-4 py-2 ${labelText} text-ink transition-colors duration-100 ` +
  'hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hair disabled:text-muted-ink disabled:hover:bg-paper disabled:hover:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

export const buttonGhost =
  `${labelText} text-ink decoration-2 underline-offset-4 transition-colors duration-100 hover:underline ` +
  'disabled:cursor-not-allowed disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

/** Small square icon-only button (mic, close, delete, preset slots). */
export const buttonIcon =
  'flex items-center justify-center border-2 border-ink bg-paper text-ink transition-colors duration-100 ' +
  'hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hair disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

export const fieldInput =
  'border-2 border-ink bg-paper px-3 py-2 font-body text-sm text-ink ' +
  'placeholder:font-body placeholder:italic placeholder:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-2';

export const fieldLabel = `${labelText} text-muted-ink`;

export const panel = 'border-2 border-ink bg-paper';
