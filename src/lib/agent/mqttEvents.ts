'use client';

import { useEffect, useRef } from 'react';

/**
 * Room buttons heard in the page, through the app server's MQTT connection
 * (/api/mqtt, lib/mqttBroker.ts). A press arrives as {"event":"press"} on the
 * button's topic, e.g. /cca/r140/button/hr4-01/1 (button 1 of hr4-01).
 */

export type MqttEvent = { topic: string; payload: unknown; at: number; retained: boolean };

/** A press of the named device: any {"event":"press"} under /cca/r140/button/<device>/ (not its battery or availability). */
export function isPress(message: MqttEvent, device: string): boolean {
  if (message.retained) return false;
  if (!message.topic.startsWith(`/cca/r140/button/${device}/`)) return false;
  const payload = message.payload as { event?: unknown } | string | null;
  const event = typeof payload === 'string' ? payload : payload?.event;
  return event === 'press';
}

/** Calls `onMessage` for each live message from the broker while the page is open. Does nothing on a hosted copy. */
export function useMqttMessages(onMessage: (message: MqttEvent) => void) {
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    fetch('/api/hosting')
      .then((res) => res.json() as Promise<{ hosted: boolean }>)
      .then(({ hosted }) => {
        if (hosted || cancelled) return;
        source = new EventSource('/api/mqtt');
        source.addEventListener('message', (e) => {
          const message = JSON.parse((e as MessageEvent<string>).data) as MqttEvent;
          if (!message.retained) handler.current(message);
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);
}
