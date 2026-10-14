import { runTurnStream, type TurnStreamEvent } from '@/lib/agent/runtime';
import type { TurnRequest } from '@/lib/agent/types';

export const maxDuration = 60;

// Streams the turn back one JSON object per line: each sentence of the reply
// as soon as it's written (so the voice can start on it), then the full
// result. If the app abandons the turn (the caller kept talking), the model
// calls stop too.
export async function POST(req: Request) {
  const body = (await req.json()) as TurnRequest;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TurnStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The app has gone (abandoned turn) — nothing to send to.
        }
      };
      try {
        await runTurnStream(body, req.signal, emit);
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      }
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
