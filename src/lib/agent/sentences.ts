/**
 * Splits a reply into sentences as it streams in, so each one can go to the
 * voice the moment it's complete instead of waiting for the whole reply.
 */

// "Dr. Smith" or "e.g. Tuesday" shouldn't end a sentence.
const ABBREVIATION = /\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|St|Sr|Jr|vs|etc|No|e\.g|i\.e|a\.m|p\.m)\.$/i;
// A sentence end: . ! ? or … (possibly repeated, possibly followed by a
// closing quote/bracket), then whitespace.
const SENTENCE_END = /[.!?…]+["'”’)\]]*\s+/g;
// Very short fragments ("Okay.") are kept with the next sentence, so the
// voice doesn't get a string of tiny clips.
const MIN_SENTENCE_CHARS = 12;

export class SentenceSplitter {
  private buffer = '';

  /** Adds streamed text; returns any sentences that are now complete. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let start = 0;
    SENTENCE_END.lastIndex = 0;
    for (let match = SENTENCE_END.exec(this.buffer); match; match = SENTENCE_END.exec(this.buffer)) {
      const end = match.index + match[0].length;
      const candidate = this.buffer.slice(start, end).trim();
      if (ABBREVIATION.test(candidate) || candidate.length < MIN_SENTENCE_CHARS) continue;
      out.push(candidate);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Whatever's left once the stream has ended. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest || null;
  }
}
