import { lookup } from 'node:dns/promises';
import net from 'node:net';
import mqtt, { type MqttClient } from 'mqtt';

/**
 * The room's MQTT broker (the Zigbee/Matter Pi, pi02zigbee.local), heard on
 * the server. One connection for the whole app, kept on globalThis so a code
 * reload doesn't open a second one. Pages listen through /api/mqtt.
 *
 * Topics look like /cca/r140/<type>/<name>/<what>, e.g.
 * /cca/r140/button/sb-01/availability or /cca/r140/remote/rb-02/action.
 */

export const DEFAULT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://pi02zigbee.local:1883';
const TOPIC = '/cca/r140/#';
const KEEP_RECENT = 50;

export type MqttMessage = { topic: string; payload: unknown; at: number; retained: boolean };
export type MqttStatus = {
  url: string;
  state: 'connecting' | 'connected' | 'offline' | 'error';
  /** The address actually used, when the name resolved to several. */
  address?: string;
  error?: string;
};
type Listener = (event: { type: 'status'; status: MqttStatus } | { type: 'message'; message: MqttMessage }) => void;

type Broker = {
  client: MqttClient | null;
  status: MqttStatus;
  /** The latest message on each topic (device state: battery, availability…). */
  latest: Map<string, MqttMessage>;
  /** The last few messages, newest last. */
  recent: MqttMessage[];
  listeners: Set<Listener>;
  /** Counts connect requests, so a slow address check for an old one is dropped. */
  attempt: number;
  /** The address that last answered, by host name. */
  lastGood: Record<string, string>;
};

const g = globalThis as typeof globalThis & { __mqttBroker?: Broker };

function broker(): Broker {
  if (!g.__mqttBroker) {
    g.__mqttBroker = {
      client: null,
      status: { url: DEFAULT_BROKER, state: 'offline' },
      latest: new Map(),
      recent: [],
      listeners: new Set(),
      attempt: 0,
      lastGood: {},
    };
  }
  // One kept from an older version of this file (a code reload) may lack newer fields.
  g.__mqttBroker.attempt ||= 0;
  g.__mqttBroker.lastGood ??= {};
  return g.__mqttBroker;
}

function emit(event: Parameters<Listener>[0]) {
  for (const listener of broker().listeners) {
    try {
      listener(event);
    } catch {
      // A page that has gone away.
    }
  }
}

function setStatus(status: MqttStatus) {
  broker().status = status;
  emit({ type: 'status', status });
}

function parse(payload: Buffer): unknown {
  const text = payload.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Connects (or reconnects to a different broker). Safe to call again: an existing connection to the same url is kept. */
export function connectBroker(url: string = broker().status.url) {
  const b = broker();
  // Already connected, or checking addresses for this broker.
  if ((b.client || b.status.state === 'connecting') && b.status.url === url) return;
  if (b.client) {
    b.client.end(true);
    b.client = null;
    b.latest.clear();
    b.recent = [];
  }
  setStatus({ url, state: 'connecting' });
  const attempt = ++b.attempt;
  const tryNow = () => {
    void reachableUrl(url).then((target) => {
      if (attempt !== broker().attempt) return; // Asked for another broker (or to disconnect) meanwhile.
      if (target) {
        open(url, target);
        return;
      }
      setStatus({ url, state: 'error', error: 'The broker is not answering. Trying again every 10 seconds.' });
      setTimeout(tryNow, 10000);
    });
  };
  tryNow();
}

/** Checks that a TCP port answers within `ms` (the Pi's link can be slow: pings of 300 ms). */
function answers(host: string, port: number, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(ms, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Addresses to try besides what the name looks up to. The Pi is on two
 * networks: the room's (192.168.9.20) and its own, which the studio Mac joins
 * (10.42.0.1). From the Mac only 10.42.0.1 answers, and a lookup of
 * pi02zigbee.local doesn't always include it. MQTT_BROKER_ADDRESSES (comma
 * separated) replaces this list.
 */
const KNOWN_ADDRESSES: Record<string, string[]> = {
  'pi02zigbee.local': (process.env.MQTT_BROKER_ADDRESSES || '10.42.0.1').split(',').map((a) => a.trim()).filter(Boolean),
};

/**
 * The url with the first address whose port answers: the last one that
 * worked, then what the name looks up to (IPv4 only — Node would try a .local
 * name's IPv6 link-local addresses first, and those fail), then the known
 * addresses above. Null when none answers.
 */
async function reachableUrl(url: string): Promise<string | null> {
  const b = broker();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const port = Number(u.port) || (u.protocol === 'mqtts:' ? 8883 : 1883);
  const host = u.hostname;
  if (net.isIP(host)) return (await answers(host, port)) ? url : null;
  const looked = await lookup(host, { all: true, family: 4 })
    .then((list) => list.map((a) => a.address))
    .catch(() => [] as string[]);
  const candidates = [...new Set([b.lastGood[host], ...looked, ...(KNOWN_ADDRESSES[host] ?? [])].filter(Boolean))];
  for (const address of candidates) {
    if (await answers(address, port)) {
      b.lastGood[host] = address;
      u.hostname = address;
      return u.toString();
    }
  }
  return null;
}

function open(url: string, target: string) {
  const b = broker();
  const client = mqtt.connect(target, { reconnectPeriod: 5000, connectTimeout: 8000, clientId: `gallery-studio-${Math.random().toString(16).slice(2, 8)}` });
  b.client = client;
  // Only the current connection reports: an old one that was ended may still fire.
  const current = () => broker().client === client;
  client.on('connect', () => {
    if (!current()) return;
    setStatus({ url, state: 'connected', address: new URL(target).hostname });
    client.subscribe(TOPIC);
  });
  client.on('reconnect', () => current() && setStatus({ url, state: 'connecting' }));
  client.on('offline', () => current() && setStatus({ url, state: 'offline' }));
  client.on('error', (err) => current() && setStatus({ url, state: 'error', error: err.message }));
  client.on('message', (topic, payload, packet) => {
    if (!current()) return;
    const message: MqttMessage = { topic, payload: parse(payload), at: Date.now(), retained: packet.retain };
    b.latest.set(topic, message);
    b.recent.push(message);
    if (b.recent.length > KEEP_RECENT) b.recent.shift();
    emit({ type: 'message', message });
  });
}

export function disconnectBroker() {
  const b = broker();
  b.attempt++;
  b.client?.end(true);
  b.client = null;
  b.latest.clear();
  b.recent = [];
  setStatus({ url: b.status.url, state: 'offline' });
}

export function publish(topic: string, payload: unknown): boolean {
  const client = broker().client;
  if (!client || broker().status.state !== 'connected') return false;
  client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return true;
}

export function snapshot() {
  const b = broker();
  return { status: b.status, latest: [...b.latest.values()], recent: b.recent };
}

export function listen(listener: Listener): () => void {
  broker().listeners.add(listener);
  return () => broker().listeners.delete(listener);
}
