/**
 * Everything the agent writes is spoken aloud, so stage directions don't
 * belong in it. The model is told not to write them, and this filter catches
 * any that slip through, as the reply streams in:
 *
 *   *a low, velvety chuckle echoes*  → removed (it describes an action)
 *   *chuckles warmly*, (laughs)      → removed
 *   a delightfully *haunting* name   → "a delightfully haunting name"
 *                                      (emphasis on a spoken word: the word stays)
 *   [warmly]                         → removed, unless the expressive voice is
 *                                      on (it performs those cues)
 *
 * Text after an opening * or ( is held back until it closes, so nothing is
 * sent to the voice before it's known whether it's a direction.
 */

// A word that makes a short aside an action or a sound, not speech.
const ACTION_WORD =
  /^(chuckl|laugh|cackl|giggl|snicker|snort|sigh|grin|smil|smirk|wink|nod|shrug|bow|lean|rub|clap|cough|clears|gasp|groan|whisper|paus|creak|thunder|howl|flutter|swoosh|music|plays|echo|sound|ahem)/i;
// Asides this long are descriptions, whatever words they use.
const MIN_DESCRIPTION_WORDS = 4;
// An opening * or ( that hasn't closed after this much text was never going to.
const MAX_HELD_CHARS = 300;

function isDirection(inner: string): boolean {
  const words = inner.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.length >= MIN_DESCRIPTION_WORDS || words.some((w) => ACTION_WORD.test(w.replace(/^[^a-z]+/i, '')));
}

export class SpokenTextFilter {
  private buffer = '';
  private lastOut = ' ';

  constructor(private keepCues: boolean) {}

  /** Adds streamed text; returns the part that's now safe to show and speak. */
  push(delta: string): string {
    this.buffer += delta;
    return this.drain(false);
  }

  /** Whatever's left once the stream has ended. */
  flush(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    // **bold** is just emphasis too.
    let text = this.buffer.replace(/\*\*/g, '*');
    let out = '';
    for (;;) {
      const next = text.search(this.keepCues ? /[*(]/ : /[*([]/);
      if (next < 0) {
        out += text;
        text = '';
        break;
      }
      out += text.slice(0, next);
      const open = text[next];
      const close = open === '*' ? '*' : open === '(' ? ')' : ']';
      const end = text.indexOf(close, next + 1);
      if (end < 0) {
        // Not closed yet: wait for more, unless it never will.
        if (!final && text.length - next < MAX_HELD_CHARS) {
          text = text.slice(next);
          break;
        }
        out += open === '*' ? '' : open; // a stray * is dropped; a stray ( stays
        text = text.slice(next + 1);
        continue;
      }
      const inner = text.slice(next + 1, end);
      if (open === '[' || isDirection(inner)) out += ' ';
      else out += open === '*' ? inner : `(${inner})`;
      text = text.slice(end + 1);
    }
    this.buffer = text;
    return this.tidy(out);
  }

  // Removing a direction leaves stray spaces ("name.  Now", " ,"); tidy them,
  // including across the joins between streamed pieces.
  private tidy(text: string): string {
    let out = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:…])/g, '$1');
    if (/\s$/.test(this.lastOut)) out = out.replace(/^[ \t]+/, '');
    if (out) this.lastOut = out;
    return out;
  }
}

// "Ha ha!", "Hahaha", "Mwahaha", "mwa-ha-ha", "Heh heh", "Hee hee" — laughter written out as words.
const WRITTEN_LAUGHTER = /\b(?:mw?a[-\s]?)?(?:ha|heh|hee)(?:[-\s,]*(?:ha|heh|hee)){1,}h?\b[!.,…]*\s*/gi;

/**
 * Laughter written out as words is read aloud letter by letter. With the
 * expressive voice it becomes a [laughs] cue (performed as a real laugh);
 * with the regular voice, which can't laugh, it's left out. Works on whole
 * sentences, so "Ha" and "ha!" arriving in separate pieces are still caught.
 */
export function replaceWrittenLaughter(sentence: string, expressive: boolean): string {
  return sentence
    .replace(WRITTEN_LAUGHTER, expressive ? '[laughs] ' : '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    // "Hahaha, splendid choice." → "Splendid choice." (after any leading cues)
    .replace(/^((?:\[[^\]]*\]\s*)*)([a-z])/, (_match, cues: string, letter: string) => cues + letter.toUpperCase());
}
