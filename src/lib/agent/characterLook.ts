/**
 * An AI character's look and colour, both kept in its library item's `value`: the orb alone ('' or a hex
 * colour, as before), or the orb on a phone's screen ('phone|' then '' or a hex colour). Keeping it in the
 * value means everything that carries a character — the timeline, the room, TouchDesigner, Copy media
 * from…, backups — carries its look too.
 */

export type CharacterLook = 'orb' | 'phone';

const PHONE = 'phone|';

export const characterLook = (value: string | undefined): CharacterLook =>
  (value ?? '').startsWith(PHONE) ? 'phone' : 'orb';

/** Its one colour (e.g. "#36d6ff"), or null for the multi-colour spectrum. */
export function characterColor(value: string | undefined): string | null {
  const v = value ?? '';
  const color = v.startsWith(PHONE) ? v.slice(PHONE.length) : v;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/** The value for a look and colour ('' or null colour = spectrum). */
export const characterValue = (look: CharacterLook, color: string | null | undefined) =>
  (look === 'phone' ? PHONE : '') + (color && /^#[0-9a-f]{6}$/i.test(color) ? color : '');
