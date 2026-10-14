import { randomUUID } from 'node:crypto';

/**
 * One-time tickets for streaming the agent's voice. The browser can only
 * play audio *as it arrives* when it loads it from a plain URL (an <audio>
 * src) — but the ElevenLabs key mustn't go in a URL. So: the app POSTs the
 * text and key, the server starts the ElevenLabs stream and parks it here
 * under a random id, and the <audio> element then plays /api/tts/stream?id=…
 * Each ticket works once and expires quickly.
 */
const TICKET_TTL_MS = 30_000;
const tickets = new Map<string, { audio: Response; createdAt: number }>();

function prune() {
  const cutoff = Date.now() - TICKET_TTL_MS;
  for (const [id, t] of tickets) {
    if (t.createdAt < cutoff) {
      tickets.delete(id);
      void t.audio.body?.cancel().catch(() => {});
    }
  }
}

export function issueTicket(audio: Response): string {
  prune();
  const id = randomUUID();
  tickets.set(id, { audio, createdAt: Date.now() });
  return id;
}

export function redeemTicket(id: string): Response | null {
  prune();
  const ticket = tickets.get(id);
  if (!ticket) return null;
  tickets.delete(id);
  return ticket.audio;
}
