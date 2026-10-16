/**
 * Shared Minimalist Monochrome building blocks. Centralizing these here
 * means every button/field across the app inverts, borders, and transitions
 * identically — the palette and motion rules only need to change in one
 * place. Compose with template strings for one-off additions (sizing,
 * layout) rather than forking these.
 */

const labelText = 'font-label text-[11px] font-normal uppercase tracking-widest';

export const buttonPrimary =
  `border-2 border-ink bg-ink px-4 py-2 ${labelText} text-paper transition-colors duration-100 ` +
  'hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:border-hair disabled:bg-hair disabled:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

// A button whose work is under way: white with black text and a black
// spinning wheel, the same whether or not the pointer is over it.
export const buttonBusy =
  `inline-flex items-center gap-2 border-2 border-ink bg-paper px-4 py-2 ${labelText} text-ink cursor-wait`;

export const buttonOutline =
  `border-2 border-ink bg-paper px-4 py-2 ${labelText} text-ink transition-colors duration-100 ` +
  'hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hair disabled:text-muted-ink disabled:hover:bg-paper disabled:hover:text-muted-ink ' +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

// The save-status buttons: solid red "Not Saved" while there are unsaved
// changes, solid green "Saved" once everything is — a deliberate break from
// monochrome so the state is obvious at a glance.
export const buttonUnsaved =
  `border-2 border-[#b91c1c] bg-[#b91c1c] px-4 py-2 text-center ${labelText} text-white transition-colors duration-150 ` +
  'hover:border-[#991b1b] hover:bg-[#991b1b] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

// Done, nothing to do: solid green like buttonSaved, but without the hover
// that would make it look like something to click.
export const buttonDone =
  `border-2 border-[#15803d] bg-[#15803d] px-4 py-2 text-center ${labelText} text-white cursor-default ` +
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

export const buttonSaved =
  `border-2 border-[#15803d] bg-[#15803d] px-4 py-2 text-center ${labelText} text-white transition-colors duration-150 ` +
  'hover:border-[#166534] hover:bg-[#166534] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-ink focus-visible:outline-offset-[3px]';

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
