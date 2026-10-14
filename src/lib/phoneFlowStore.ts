import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PhonePayload } from './phonePayload';

/**
 * The one conversation flow currently "sent to the iPhone app" — the
 * computer pushes it here (Phone testing → Send to iPhone app), the native
 * app pulls it on launch. Unlike the Safari link (whole flow encoded in the
 * URL fragment), the native app always opens the same fixed URL, so the
 * flow has to live somewhere it can fetch instead.
 *
 * Kept in memory and mirrored to a small JSON file so a dev-server restart
 * (which happens — that's exactly what broke the last test session) doesn't
 * make the phone forget what it was sent. Never holds API keys: the
 * payload type has none, and the phone keeps its own.
 */
export type SentPhoneFlow = { flow: PhonePayload; sentAt: number };

const STORE_FILE = path.join(process.cwd(), '.data', 'phone-flow.json');

let current: SentPhoneFlow | null | undefined;

export function getPhoneFlow(): SentPhoneFlow | null {
  if (current === undefined) {
    try {
      current = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as SentPhoneFlow;
    } catch {
      current = null;
    }
  }
  return current;
}

export function setPhoneFlow(flow: PhonePayload): SentPhoneFlow {
  current = { flow, sentAt: Date.now() };
  try {
    mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(current));
  } catch {
    // Disk mirror is a convenience — the in-memory copy still serves the
    // phone for as long as this server process runs.
  }
  return current;
}
