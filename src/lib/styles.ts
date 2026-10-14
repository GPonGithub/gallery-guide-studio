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

// The header Save button while there are unsaved changes: grey, with "Not
// saved" in red — a deliberate break from monochrome so it can't be missed.
export const buttonUnsaved =
  `border-2 border-[#9ca3af] bg-[#e5e7eb] px-4 py-2 ${labelText} text-[#b91c1c] transition-colors duration-100 ` +
  'hover:bg-[#d1d5db] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

// The one deliberate break from the otherwise-strict monochrome system —
// reserved for destructive actions (e.g. "Reset from Figma"), never used
// for anything else, so red stays a reliable danger signal.
export const buttonDanger =
  `border-2 border-[#b91c1c] bg-[#b91c1c] px-4 py-2 ${labelText} text-paper transition-colors duration-100 ` +
  'hover:bg-paper hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:border-hair disabled:bg-hair disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#b91c1c] focus-visible:outline-offset-[3px]';

// A second deliberate break from the monochrome system, same reasoning as
// buttonDanger above — reserved for "Update FigJam file" going live the
// moment there's something real to push, so green stays a reliable signal
// distinct from red's "this is destructive."
export const buttonSuccess =
  `border-2 border-[#15803d] bg-[#15803d] px-4 py-2 ${labelText} text-paper transition-colors duration-100 ` +
  'hover:bg-paper hover:text-[#15803d] disabled:cursor-not-allowed disabled:border-hair disabled:bg-hair disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#15803d] focus-visible:outline-offset-[3px]';

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
