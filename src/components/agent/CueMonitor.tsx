'use client';

import { useEffect, useState } from 'react';
import type { AgentFlow, CueEvent, CueStatus } from '@/lib/agent/types';

// Shows what's going to TouchDesigner: the latest message, the moment it's
// sent, kept on screen until the next one — plus a small marker in the
// conversation at the point each one went out (CueMarker). Its title bar
// folds it up to one line (remembered in this browser).

const OPEN_KEY = 'td-window-open';

/** A cue as the app saw it: when it went out, and where in the conversation. */
export type SentCue = CueEvent & {
  /** When it was sent (ms since epoch). */
  at: number;
  /** It went out just before message number `afterMessage` (0 = before the first). */
  afterMessage: number;
};

export function cueStatusLabel(status: CueStatus): string {
  switch (status) {
    case 'sent':
      return 'Sent ✓';
    case 'failed':
      return 'TouchDesigner didn’t answer ✗';
    case 'logged':
      return 'Not sent — no TouchDesigner address set';
    default:
      return 'Sending…';
  }
}

const statusColor = (status: CueStatus) =>
  status === 'sent' ? 'text-[#15803d]' : status === 'failed' ? 'text-[#b91c1c]' : 'text-muted-ink';

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

type Timing = NonNullable<AgentFlow['tdTiming']>;

const TIMINGS: { value: Timing; label: string; hint: string }[] = [
  { value: 'spoken', label: 'When spoken', hint: 'Each cue waits until the agent’s voice starts saying the reply it goes with' },
  {
    value: 'decided',
    label: 'When decided',
    hint: 'Each cue goes the moment the agent decides (new stage, information collected) — up to a second or so before the reply is heard',
  },
];

export function CueMonitor({
  latest,
  count,
  tdUrl,
  timing,
  onTimingChange,
  hosted = false,
}: {
  /** A hosted copy never sends cues (see tdAddress in runtime.ts). */
  hosted?: boolean;
  latest: SentCue | null;
  count: number;
  tdUrl: string;
  timing: Timing;
  onTimingChange: (timing: Timing) => void;
}) {
  const address = tdUrl.trim();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (window.localStorage.getItem(OPEN_KEY) === 'false') setOpen(false);
    } catch {
      // Storage blocked: it starts open.
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(OPEN_KEY, String(!o));
      } catch {
        // As above.
      }
      return !o;
    });
  };
  return (
    <section className="border-t-2 border-ink px-3 py-2" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2 font-label text-[10px] uppercase tracking-widest text-muted-ink">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left hover:text-ink"
          title={open ? 'Fold the TouchDesigner window away' : 'Show the TouchDesigner window'}
        >
          <span className={`inline-block w-3 shrink-0 text-ink transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true">
            ▶
          </span>
          <span className="bg-ink px-1 text-paper">TD</span>
          <span className="text-ink">TouchDesigner</span>
          {open ? (
            <span className="normal-case tracking-normal">
              {hosted
                ? 'shown here only — the hosted app can’t reach TouchDesigner; run Chatbot Designer on the TouchDesigner computer to send cues'
                : address
                  ? `→ ${address}`
                  : 'no address set (Master card) — cues are shown here but not sent'}
            </span>
          ) : (
            latest && (
              <span className="normal-case tracking-normal">
                · latest: <b className="text-ink">{latest.name}</b> ({cueStatusLabel(latest.status)})
              </span>
            )
          )}
        </button>
        <span className="ml-auto flex items-center gap-1">
          {count > 0 && <span className="mr-2">{count} this conversation</span>}
          Send
          {TIMINGS.map((t) => (
            <button
              key={t.value}
              onClick={() => onTimingChange(t.value)}
              aria-pressed={timing === t.value}
              title={t.hint}
              className={`border px-1.5 py-0.5 ${
                timing === t.value ? 'border-ink bg-ink text-paper' : 'border-hair text-muted-ink hover:border-ink hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </span>
      </div>
      {!open ? null : latest ? (
        // Keyed by cue, so each new message replays the highlight.
        <div key={latest.id} className="cue-flash mt-1.5 flex flex-col gap-1 border-2 border-ink px-2 py-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 font-body text-sm">
            <b className="font-label text-[12px] text-ink">{latest.name}</b>
            <span className={`font-label text-[10px] uppercase tracking-wide ${statusColor(latest.status)}`}>
              {cueStatusLabel(latest.status)}
            </span>
            <span className="font-label text-[10px] tabular-nums text-muted-ink">{time(latest.at)}</span>
            <span className="text-xs text-muted-ink">· {latest.trigger}</span>
          </div>
          <code className="block max-h-16 overflow-y-auto break-all font-label text-[11px] leading-snug text-ink">
            {JSON.stringify(latest.payload)}
          </code>
        </div>
      ) : (
        <p className="mt-1 font-body text-xs italic text-muted-ink">No messages sent yet in this conversation.</p>
      )}
    </section>
  );
}

/** The line in the conversation showing where a cue went out. */
export function CueMarker({ cue }: { cue: SentCue }) {
  return (
    <div className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest" title={JSON.stringify(cue.payload)}>
      <span className="h-px flex-1 bg-hair" />
      <span className={statusColor(cue.status)}>
        <span className="bg-ink px-1 text-paper">TD</span> {cue.name} ·{' '}
        {cue.status === 'logged' ? 'not sent (no address)' : cueStatusLabel(cue.status)} · {time(cue.at)}
      </span>
      <span className="h-px flex-1 bg-hair" />
    </div>
  );
}
