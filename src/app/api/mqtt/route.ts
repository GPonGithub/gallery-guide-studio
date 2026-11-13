import { connectBroker, disconnectBroker, listen, publish, snapshot } from '@/lib/mqttBroker';
import { isHosted } from '@/lib/serverKeys';

// The room's MQTT broker (see mqttBroker). GET streams Server-Sent Events:
// first a "snapshot" (status, each topic's latest message, recent messages),
// then "status" and "message" events as they happen. Opening the stream
// connects to the broker if the app isn't connected yet.
export function GET(req: Request) {
  if (isHosted) return Response.json({ error: 'The MQTT broker is only reachable from the studio computer.' }, { status: 404 });
  connectBroker();
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      send('snapshot', snapshot());
      const unlisten = listen((e) => send(e.type, e.type === 'status' ? e.status : e.message));
      // A comment line every 20 s keeps the connection open.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stop();
        }
      }, 20000);
      stop = () => {
        unlisten();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      req.signal.addEventListener('abort', () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
  });
}

// POST {action:'connect', url?} | {action:'disconnect'} | {action:'publish', topic, payload}
export async function POST(req: Request) {
  if (isHosted) return Response.json({ error: 'Not on a hosted copy.' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; url?: string; topic?: string; payload?: unknown };
  if (body.action === 'connect') {
    const url = body.url?.trim();
    if (url && !/^(mqtts?|wss?):\/\/[\w.-]+(:\d+)?\/?$/.test(url)) {
      return Response.json({ error: 'Use an address like mqtt://pi02zigbee.local:1883' }, { status: 400 });
    }
    connectBroker(url || undefined);
    return Response.json(snapshot().status);
  }
  if (body.action === 'disconnect') {
    disconnectBroker();
    return Response.json(snapshot().status);
  }
  if (body.action === 'publish' && body.topic) {
    return Response.json({ ok: publish(body.topic, body.payload ?? '') });
  }
  return Response.json(snapshot());
}
