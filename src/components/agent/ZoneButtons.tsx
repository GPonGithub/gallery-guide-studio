'use client';

import { ZONES } from '@/lib/agent/projectionLayout';
import { setPlacing, usePlacing } from '@/lib/agent/roomPlacement';
import { setZone, useZone } from '@/lib/agent/zones';
import { fieldLabel } from '@/lib/styles';

/**
 * Zone 1 / 2 / 3: which zone's drawing Adding Immersive Media shows (zone 2 is the room, on projectors
 * 1–4; zones 1 and 3 the two corners, on projectors 5 and 6). They sit in the middle of the top bar.
 */
export function ZoneButtons({ className = '' }: { className?: string }) {
  const zone = useZone();
  const placing = usePlacing();
  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="group" aria-label="Zones" data-tour="zone-buttons">
      <span className={`mr-1 ${fieldLabel}`}>Zone</span>
      {ZONES.map((z) => {
        const selected = z.id === zone;
        const lights = `projector${z.projectors.length > 1 ? 's' : ''} ${z.projectors[0]}${z.projectors.length > 1 ? `–${z.projectors.at(-1)}` : ''}`;
        return (
          <button
            key={z.id}
            onClick={() => {
              // Letting go of a picture being placed in the zone being left.
              if (placing && !selected) setPlacing(null);
              setZone(z.id);
            }}
            aria-pressed={selected}
            title={`Zone ${z.id} · ${z.areas.length} projection areas (${lights})`}
            className={`h-9 min-w-9 border-2 px-2 font-label text-[12px] tabular-nums transition-colors ${
              selected ? 'border-ink bg-ink text-paper' : 'border-ink bg-paper text-ink hover:bg-muted'
            }`}
          >
            {z.id}
          </button>
        );
      })}
    </div>
  );
}
