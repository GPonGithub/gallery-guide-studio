'use client';

/**
 * The character page's orb. In this browser it follows the voice from the Designer's tab
 * (voiceLevel.ts). Given `td` (TouchDesigner's receiver, e.g. ws://localhost:9980) — as when
 * TouchDesigner itself shows this page in a projection area — it also connects there and follows
 * the voice readings the Designer sends TouchDesigner.
 */

import { useCallback, useEffect, useRef } from 'react';
import AiCharacterOrb from '@/components/agent/AiCharacterOrb';
import { currentVoiceReading, type VoiceReading } from '@/lib/agent/voiceLevel';

const SILENT: VoiceReading = { level: 0, low: 0, mid: 0, high: 0 };

export default function ShowOrb({ color, td }: { color: string | null; td: string | null }) {
  const heard = useRef<{ r: VoiceReading; at: number }>({ r: SILENT, at: 0 });

  useEffect(() => {
    if (!td) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    // Says "listening" on connecting and every few seconds after, so TouchDesigner keeps sending
    // even if its receiver code was reloaded (which forgets who was listening).
    let ping: ReturnType<typeof setInterval> | null = null;
    const listen = () => socket?.readyState === WebSocket.OPEN && socket.send('{"type":"voice","action":"listen"}');
    const open = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(td);
      } catch {
        return;
      }
      socket.onopen = () => {
        listen();
        ping = setInterval(listen, 3000);
      };
      socket.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as Partial<VoiceReading> & { type?: string };
          if (m.type !== 'voice') return;
          heard.current = {
            r: { level: m.level ?? 0, low: m.low ?? 0, mid: m.mid ?? 0, high: m.high ?? 0 },
            at: performance.now(),
          };
        } catch {
          // Not a reading (e.g. the receiver's reply to "listen").
        }
      };
      socket.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (!stopped) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      socket?.close();
    };
  }, [td]);

  // A reading from TouchDesigner older than a quarter second counts as silence (the voice stopped).
  const read = useCallback(() => {
    const h = heard.current;
    const there = performance.now() - h.at < 250 ? h.r : SILENT;
    const here = currentVoiceReading();
    return there.level > here.level ? there : here;
  }, []);

  return <AiCharacterOrb color={color} read={read} />;
}
