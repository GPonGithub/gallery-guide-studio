/**
 * The pause between the bot's spoken sentences, set in the scene's "Describe the Conversation" (row 3
 * of the sheet), e.g.
 *
 *   Always include a 1 second silence gap between each sentence.
 *   Pause between sentences: 0.5 seconds
 *
 * Any sentence there that names a number of seconds and "between … sentence(s)" counts. The app does
 * the pausing (the voice can't be told to leave silence, and the AI can't write it), so that sentence is
 * also taken out of what the AI designing the stages reads — otherwise it may try to "write" the pauses.
 * Without one, the pause is DEFAULT_PAUSE_MS.
 */

export const DEFAULT_PAUSE_MS = 500;
const MAX_PAUSE_MS = 5000;

const WORDS: Record<string, number> = {
  'half a': 0.5,
  'a half': 0.5,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};
const SECONDS = /(\d+(?:[.,]\d+)?|half a|a half|an?|one|two|three|four|five)[\s-]*(?:seconds?|secs?|s)\b/i;
const BETWEEN_SENTENCES = /\bbetween\b.*\bsentences?\b|\bsentences?\b.*\bpause\b|\bpause\b.*\bsentences?\b/i;

// The description's sentences, each with where it is, so one can be taken out as written.
// (A point inside a number, as in 1.5, doesn't end a sentence.)
const sentencesOf = (text: string) => text.match(/(?:[^\n.!?]|\.(?=\d))*(?:[.!?]+|\n|$)/g) ?? [];

function pauseIn(sentence: string): number | null {
  if (!BETWEEN_SENTENCES.test(sentence)) return null;
  const m = sentence.match(SECONDS);
  if (!m) return null;
  const n = WORDS[m[1].toLowerCase()] ?? Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_PAUSE_MS, Math.round(n * 1000))) : null;
}

/** The pause the description asks for, in milliseconds (the last one, if it asks more than once). */
export function sentencePauseMs(description: string | null | undefined): number {
  let found: number | null = null;
  for (const s of sentencesOf(description ?? '')) found = pauseIn(s) ?? found;
  return found ?? DEFAULT_PAUSE_MS;
}

/** The description without its pause sentence(s), for the AI that designs the stages. */
export function withoutPauseLine(description: string): string {
  return sentencesOf(description)
    .map((s) => (pauseIn(s) === null ? s : s.endsWith('\n') ? '\n' : ''))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}
