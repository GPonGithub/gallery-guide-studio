'use client';

import { findStage } from '@/lib/agent/flow';
import type { AgentEvent, AgentFlow, SessionState } from '@/lib/agent/types';
import { fieldLabel } from '@/lib/styles';
import { cueStatusLabel } from './CueMonitor';

export type TurnLog = { turn: number; userText: string | null; events: AgentEvent[]; timings: string[] };

// Makes the agent's reasoning visible: where the conversation is, what's
// been collected and what's still missing, and — turn by turn — why it
// moved, what it ignored, and every cue it sent to TouchDesigner.

function EventLine({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case 'slot':
      return (
        <li>
          <span className="font-label">✓ {event.name}</span> = &ldquo;{event.value}&rdquo;
        </li>
      );
    case 'stage':
      return (
        <li className="font-medium">
          → Moved {event.from} → {event.to} <span className="font-normal text-muted-ink">— {event.reason}</span>
        </li>
      );
    case 'complete':
      return <li className="font-medium">★ Goal met for {event.stage}</li>;
    case 'cue':
      return (
        <li>
          <span className="bg-ink px-1 font-label text-[11px] text-paper">TD</span>{' '}
          <span className="font-label">{event.name}</span>{' '}
          <span className="text-muted-ink">
            ({event.trigger}) —{' '}
            {cueStatusLabel(event.status)}
          </span>
        </li>
      );
    case 'offTopic':
      return <li>↺ Off topic ({event.streak} in a row)</li>;
    case 'end':
      return <li className="font-medium">■ Conversation ended — {event.reason}</li>;
    case 'note':
      return <li className="italic text-muted-ink">{event.text}</li>;
    case 'saved':
      return (
        <li>
          💾 Saved for later scenes: <span className="font-label">{event.label}</span> = {event.value}
        </li>
      );
    case 'rejected':
      return <li className="text-[#b91c1c]">⚠ {event.text}</li>;
  }
}

export function Inspector({ flow, state, log }: { flow: AgentFlow; state: SessionState; log: TurnLog[] }) {
  const stage = findStage(flow, state.stageCode);
  const stageSlotNames = new Set(stage?.collect.map((s) => s.name));
  const otherKnown = Object.entries(state.slots).filter(([k]) => !stageSlotNames.has(k));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section className="border-2 border-ink p-3">
        <p className={fieldLabel}>Current stage</p>
        {stage ? (
          <>
            <p className="mt-1 font-display text-lg leading-tight text-ink">
              {stage.code} · {stage.name}
            </p>
            <p className="mt-1 font-body text-[13px] leading-snug text-ink">{stage.goal}</p>
          </>
        ) : (
          <p className="mt-1 font-body text-sm text-muted-ink">None</p>
        )}
        <p className="mt-2 font-label text-[10px] uppercase tracking-wide text-muted-ink">
          {state.ended
            ? 'Conversation ended'
            : `Turns here: ${state.turnsInStage} · Off topic in a row: ${state.offTopicStreak}`}
        </p>
        {state.completedStages.length > 0 && (
          <p className="mt-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">
            Goals met: {state.completedStages.join(', ')}
          </p>
        )}
      </section>

      <section>
        <p className={fieldLabel}>Information</p>
        <ul className="mt-1 flex flex-col gap-1 font-body text-[13px]">
          {stage?.collect.map((s) => (
            <li key={s.name} className="flex justify-between gap-2 border-b border-hair pb-1">
              <span className="font-label text-[12px]">{s.name}</span>
              {state.slots[s.name] ? (
                <span className="text-right text-ink">{state.slots[s.name]}</span>
              ) : (
                <span className="text-right italic text-muted-ink">{s.required ? 'missing' : 'optional'}</span>
              )}
            </li>
          ))}
          {stage && stage.collect.length === 0 && <li className="italic text-muted-ink">This stage collects nothing.</li>}
          {otherKnown.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2 border-b border-hair pb-1 text-muted-ink">
              <span className="font-label text-[12px]">{k}</span>
              <span className="text-right">{v}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <p className={fieldLabel}>What happened, newest first</p>
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
          {log.length === 0 && <p className="font-body text-[13px] italic text-muted-ink">Nothing yet.</p>}
          {[...log].reverse().map((entry) => (
            <div key={entry.turn} className="border-b border-hair py-2">
              <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
                Turn {entry.turn}
                {entry.userText === null ? ' · opening' : ''}
                {entry.timings.length > 0 ? ` · ${entry.timings.join(', ')}` : ''}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 font-body text-[13px] leading-snug text-ink">
                {entry.events.length === 0 ? (
                  <li className="italic text-muted-ink">No changes.</li>
                ) : (
                  entry.events.map((event, i) => <EventLine key={i} event={event} />)
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
