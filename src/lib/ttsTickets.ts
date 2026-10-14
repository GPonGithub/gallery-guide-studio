import { randomUUID } from 'node:crypto';

/**
 * One-time tickets for streaming the agent's voice. The browser can only
 * play audio *as it arrives* when it loads it from a plain URL (an <audio>
 * src) — but the ElevenLabs key mustn't go in a URL. So: the app POSTs the
 * text and key, the server starts the ElevenLabs stream and parks it here
 * under a random id, and the <audio> element then plays /api/tts/stream?id=…
 *
 * The audio is read from ElevenLabs straight away and kept in memory, rather
 * than left waiting until the player asks for it. A reply is spoken sentence
 * by sentence, so a later sentence's ticket can wait several seconds for its
 * turn — and an ElevenLabs connection left idle that long can be closed
 * mid-stream, which the player sees as a broken file.
 */
const TICKET_TTL_MS = 120_000;

type Ticket = {
  chunks: Uint8Array[];
  done: boolean;
  failed: boolean;
  wakers: (() => void)[];
  contentType: string;
  createdAt: number;
  redeemed: boolean;
};

const tickets = new Map<string, Ticket>();

function prune() {
  const cutoff = Date.now() - TICKET_TTL_MS;
  for (const [id, t] of tickets) if (t.createdAt < cutoff) tickets.delete(id);
}

function wake(t: Ticket) {
  const wakers = t.wakers;
  t.wakers = [];
  for (const w of wakers) w();
}

export function issueTicket(audio: Response): string {
  prune();
  const id = randomUUID();
  const ticket: Ticket = {
    chunks: [],
    done: false,
    failed: false,
    wakers: [],
    contentType: audio.headers.get('content-type') || 'audio/mpeg',
    createdAt: Date.now(),
    redeemed: false,
  };
  tickets.set(id, ticket);
  // Drain ElevenLabs right away, whether or not anyone is listening yet.
  void (async () => {
    try {
      const reader = audio.body?.getReader();
      if (!reader) throw new Error('No audio body');
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          ticket.chunks.push(value);
          wake(ticket);
        }
      }
    } catch {
      ticket.failed = true;
    }
    ticket.done = true;
    wake(ticket);
  })();
  return id;
}

/** The audio for a ticket as a stream: everything received so far, then the rest as it arrives. Works once. */
export function redeemTicket(id: string): Response | null {
  prune();
  const ticket = tickets.get(id);
  if (!ticket || ticket.redeemed) return null;
  ticket.redeemed = true;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (index < ticket.chunks.length) {
          controller.enqueue(ticket.chunks[index++]);
          return;
        }
        if (ticket.done) {
          tickets.delete(id);
          if (ticket.failed) controller.error(new Error('The voice stream from ElevenLabs broke off.'));
          else controller.close();
          return;
        }
        await new Promise<void>((resolve) => ticket.wakers.push(resolve));
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': ticket.contentType, 'Cache-Control': 'no-store' } });
}
