'use client';

import { KIND_BADGE, WHEN_LABEL, type ActionKind, type EveryWhen } from '@/lib/agent/media';
import { areasText } from '@/lib/agent/mediaShow';

/** A sound the conversation played (an "every time" media action), and where in the conversation. */
export type PlayedSound = {
  id: string;
  at: number;
  /** It played just before message number `afterMessage` (0 = before the first). */
  afterMessage: number;
  assetId: string;
  name: string;
  when: EveryWhen;
  /** Every time (labelled by its event), throughout the scene, at the start or at the end. */
  kind?: ActionKind;
  action: string;
  /** Why it couldn't play, if it couldn't. */
  problem?: string;
  /** A "once" action's media shown (or played) or removed (or stopped) when the conversation triggered it. */
  event?: 'shown' | 'removed';
  /** An image or video: the projection areas it showed in. */
  areas?: number[];
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

/** What happened, in a few words: "every time" sounds by their event, others by their kind or what was done. */
function whatHappened(p: PlayedSound): string {
  if (p.areas) {
    if (p.problem) return `couldn’t show in ${areasText(p.areas)}`;
    return p.event === 'removed' ? `removed from ${areasText(p.areas)}` : `shown in ${areasText(p.areas)}`;
  }
  if (p.event === 'removed') return 'stopped';
  if (p.event === 'shown' && p.kind === 'once') return 'when user instructs';
  return (p.kind && p.kind !== 'every' ? KIND_BADGE[p.kind] : WHEN_LABEL[p.when]).toLowerCase();
}

/** A small line in the conversation where a media action's sound played (or its picture showed), like the TouchDesigner markers. */
export function MediaMarker({ played }: { played: PlayedSound }) {
  const visual = played.areas !== undefined;
  return (
    <div
      className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest"
      title={`${played.action}${played.problem ? ` — ${played.problem}` : ''}`}
    >
      <span className="h-px flex-1 bg-hair" />
      <span className={played.problem ? 'text-[#b91c1c]' : 'text-[#3c5eac]'}>
        <span className="bg-[#3c5eac] px-1 text-paper">{visual ? '▣' : '♪'}</span> {played.assetId} {played.name} ·{' '}
        {whatHappened(played)} · {played.problem ? (visual ? 'couldn’t show' : 'couldn’t play') : time(played.at)}
      </span>
      <span className="h-px flex-1 bg-hair" />
    </div>
  );
}
