'use client';

import { WHEN_LABEL, type EveryWhen } from '@/lib/agent/media';

/** A sound the conversation played (an "every time" media action), and where in the conversation. */
export type PlayedSound = {
  id: string;
  at: number;
  /** It played just before message number `afterMessage` (0 = before the first). */
  afterMessage: number;
  assetId: string;
  name: string;
  when: EveryWhen;
  action: string;
  /** Why it couldn't play, if it couldn't. */
  problem?: string;
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

/** A small line in the conversation where a media action's sound played, like the TouchDesigner markers. */
export function MediaMarker({ played }: { played: PlayedSound }) {
  return (
    <div
      className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest"
      title={`${played.action}${played.problem ? ` — ${played.problem}` : ''}`}
    >
      <span className="h-px flex-1 bg-hair" />
      <span className={played.problem ? 'text-[#b91c1c]' : 'text-[#3c5eac]'}>
        <span className="bg-[#3c5eac] px-1 text-paper">♪</span> {played.assetId} {played.name} ·{' '}
        {WHEN_LABEL[played.when].toLowerCase()} · {played.problem ? 'couldn’t play' : time(played.at)}
      </span>
      <span className="h-px flex-1 bg-hair" />
    </div>
  );
}
