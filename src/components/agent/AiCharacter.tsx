'use client';

/**
 * An AI character as its library item says: the orb alone, or the orb in the middle of a phone's screen
 * (characterLook.ts). Around the phone nothing is drawn — the page shows through (transparent), so it
 * sits on whatever is behind it; in the room each area shows one item at a time, so there it's black.
 */

import { useEffect, useRef, useState } from 'react';
import AiCharacterOrb from './AiCharacterOrb';
import { characterColor, characterLook } from '@/lib/agent/characterLook';
import type { VoiceReading } from '@/lib/agent/voiceLevel';

type Props = { value: string | undefined; read?: () => VoiceReading; className?: string };

export default function AiCharacter({ value, read, className }: Props) {
  const color = characterColor(value);
  return characterLook(value) === 'phone' ? (
    <AiPhone color={color} read={read} className={className} />
  ) : (
    <AiCharacterOrb color={color} read={read} className={className} />
  );
}

/** A phone's proportions (width : height), a modern all-screen phone. */
const PHONE_W = 9;
const PHONE_H = 19.5;

/**
 * A generic all-screen phone, upright and centred, as large as fits (92% of the box's height or width),
 * with the AI character in the middle of its black screen. No maker's logo or buttons' labels.
 */
export function AiPhone({ color, read, className }: { color: string | null; read?: () => VoiceReading; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const h = Math.min(r.height * 0.92, ((r.width * 0.92) / PHONE_W) * PHONE_H);
      setSize(h > 0 ? { w: (h / PHONE_H) * PHONE_W, h } : null);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = size?.w ?? 0;
  return (
    <div ref={box} className={`relative flex h-full w-full items-center justify-center ${className ?? ''}`}>
      {size && (
        <div className="relative" style={{ width: size.w, height: size.h }}>
          {/* Side buttons: volume on the left, power on the right. */}
          <span className="absolute rounded-l-sm bg-[#3a3a3c]" style={{ left: -s * 0.018, top: '20%', width: s * 0.02, height: '6%' }} />
          <span className="absolute rounded-l-sm bg-[#3a3a3c]" style={{ left: -s * 0.018, top: '28%', width: s * 0.02, height: '6%' }} />
          <span className="absolute rounded-r-sm bg-[#3a3a3c]" style={{ right: -s * 0.018, top: '24%', width: s * 0.02, height: '10%' }} />
          {/* The body, its edge catching the light, then the screen inside it. */}
          <div
            className="absolute inset-0 bg-[#1c1c1e]"
            style={{ borderRadius: s * 0.16, boxShadow: `inset 0 0 0 ${Math.max(1, s * 0.012)}px #48484a` }}
          >
            <div
              className="absolute overflow-hidden bg-black"
              style={{ inset: s * 0.035, borderRadius: s * 0.13 }}
            >
              {/* The whole screen is the orb's canvas: the sphere is sized by the screen's width (as on a
                  square), and its glow fades out across the screen to the frame — no square edge where a
                  smaller canvas would cut the halo off (it showed as the voice brightened the glow). */}
              <div className="absolute inset-0">
                <AiCharacterOrb color={color} read={read} />
              </div>
              {/* The camera's pill at the top of the screen. */}
              <span
                className="absolute left-1/2 -translate-x-1/2 rounded-full bg-[#0b0b0b]"
                style={{ top: s * 0.035, width: s * 0.3, height: s * 0.085, boxShadow: '0 0 0 1px #1c1c1e' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
