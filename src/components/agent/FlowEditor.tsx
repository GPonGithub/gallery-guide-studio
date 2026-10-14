'use client';

import type { ReactNode } from 'react';
import { END, type AgentFlow, type Cue, type CueTrigger, type Exit, type Slot, type Stage, type Steering } from '@/lib/agent/types';
import { sortStages } from '@/lib/agent/flow';
import { buttonGhost, buttonIcon, fieldInput, fieldLabel } from '@/lib/styles';

// The typed-in equivalent of a FigJam "stage card": every field a student
// fills in to define a stage, plus the master card for the whole flow.

const input = `w-full ${fieldInput}`;
const smallInput = `w-full border-2 border-ink bg-paper px-2 py-1 font-body text-[13px] text-ink placeholder:italic placeholder:text-muted-ink`;
const textarea = `${input} min-h-[64px] resize-y leading-snug`;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      {hint && <span className="font-body text-xs italic text-muted-ink">{hint}</span>}
      {children}
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`h-7 w-7 shrink-0 text-sm ${buttonIcon}`} aria-label={label} title={label}>
      ×
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`self-start ${buttonGhost}`}>
      + {children}
    </button>
  );
}

function update<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

const toSlotName = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '');

function SlotRows({ slots, onChange }: { slots: Slot[]; onChange: (slots: Slot[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {slots.map((slot, i) => (
        <div key={i} className="flex flex-col gap-1 border-l-2 border-hair pl-2">
          <div className="flex items-center gap-2">
            <input
              value={slot.name}
              onChange={(e) => onChange(update(slots, i, { name: toSlotName(e.target.value) }))}
              placeholder="name, e.g. patient_name"
              className={`${smallInput} font-label`}
            />
            <label className="flex shrink-0 items-center gap-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">
              <input
                type="checkbox"
                checked={slot.required}
                onChange={(e) => onChange(update(slots, i, { required: e.target.checked }))}
                className="accent-ink"
              />
              Required
            </label>
            <RemoveButton onClick={() => onChange(slots.filter((_, j) => j !== i))} label="Remove this item" />
          </div>
          <input
            value={slot.description}
            onChange={(e) => onChange(update(slots, i, { description: e.target.value }))}
            placeholder="what it is, e.g. the caller's full name"
            className={smallInput}
          />
        </div>
      ))}
      <AddButton onClick={() => onChange([...slots, { name: '', description: '', required: true }])}>Add information</AddButton>
    </div>
  );
}

function ExitRows({
  exits,
  stages,
  allowOnComplete,
  onChange,
}: {
  exits: Exit[];
  stages: Stage[];
  allowOnComplete: boolean;
  onChange: (exits: Exit[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {exits.map((exit, i) => (
        <div key={i} className="flex flex-col gap-1 border-l-2 border-hair pl-2">
          <div className="flex items-center gap-2">
            <span className="font-label text-[11px] text-muted-ink">→</span>
            <select
              value={exit.to}
              onChange={(e) => onChange(update(exits, i, { to: e.target.value }))}
              className={`${smallInput} font-label`}
            >
              <option value="">Choose…</option>
              {sortStages(stages).map((s) => (
                <option key={s.id} value={s.code}>
                  {s.code} {s.name}
                </option>
              ))}
              <option value={END}>END the conversation</option>
            </select>
            <RemoveButton onClick={() => onChange(exits.filter((_, j) => j !== i))} label="Remove this exit" />
          </div>
          {allowOnComplete && (
            <label className="flex items-center gap-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">
              <input
                type="checkbox"
                checked={exit.onComplete}
                onChange={(e) => onChange(update(exits, i, { onComplete: e.target.checked }))}
                className="accent-ink"
              />
              Take automatically when the goal is met
            </label>
          )}
          <input
            value={exit.when}
            onChange={(e) => onChange(update(exits, i, { when: e.target.value }))}
            placeholder={exit.onComplete ? 'note, e.g. say goodbye' : 'when, e.g. the caller wants to pay a bill'}
            className={smallInput}
          />
        </div>
      ))}
      <AddButton onClick={() => onChange([...exits, { to: '', when: '', onComplete: false }])}>Add exit</AddButton>
    </div>
  );
}

const TRIGGERS: { value: CueTrigger; label: string; stageOnly?: boolean }[] = [
  { value: 'enter', label: 'On entering this stage', stageOnly: true },
  { value: 'complete', label: 'When the goal is met', stageOnly: true },
  { value: 'exit', label: 'On leaving this stage', stageOnly: true },
  { value: 'slot', label: 'When information is collected' },
  { value: 'moment', label: 'At a moment (described)' },
];

function CueRows({
  cues,
  slotNames,
  stageOnly,
  onChange,
}: {
  cues: Cue[];
  slotNames: string[];
  stageOnly: boolean;
  onChange: (cues: Cue[]) => void;
}) {
  const triggers = TRIGGERS.filter((t) => stageOnly || !t.stageOnly);
  return (
    <div className="flex flex-col gap-2">
      {cues.map((cue, i) => (
        <div key={i} className="flex flex-col gap-1 border-l-2 border-hair pl-2">
          <div className="flex items-center gap-2">
            <input
              value={cue.name}
              onChange={(e) => onChange(update(cues, i, { name: e.target.value.toUpperCase().replace(/\s+/g, '_') }))}
              placeholder="CUE_NAME"
              className={`${smallInput} font-label`}
            />
            <RemoveButton onClick={() => onChange(cues.filter((_, j) => j !== i))} label="Remove this cue" />
          </div>
          <select
            value={cue.on}
            onChange={(e) => onChange(update(cues, i, { on: e.target.value as CueTrigger }))}
            className={smallInput}
          >
            {triggers.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {cue.on === 'slot' && (
            <select
              value={cue.slot ?? ''}
              onChange={(e) => onChange(update(cues, i, { slot: e.target.value }))}
              className={`${smallInput} font-label`}
            >
              <option value="">Which information?</option>
              {slotNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          {cue.on === 'moment' && (
            <input
              value={cue.when ?? ''}
              onChange={(e) => onChange(update(cues, i, { when: e.target.value }))}
              placeholder="e.g. the agent tells the caller the bill amount"
              className={smallInput}
            />
          )}
        </div>
      ))}
      <AddButton onClick={() => onChange([...cues, { name: '', on: stageOnly ? 'enter' : 'slot' }])}>Add cue</AddButton>
    </div>
  );
}

const STEERING: { value: Steering; label: string }[] = [
  { value: 'strict', label: 'Strict — pull straight back to the goal' },
  { value: 'balanced', label: 'Balanced — answer briefly, then steer back' },
  { value: 'relaxed', label: 'Relaxed — chat a little, then steer back' },
];

export function StageEditor({
  stage,
  flow,
  onChange,
  onDelete,
}: {
  stage: Stage;
  flow: AgentFlow;
  onChange: (patch: Partial<Stage>) => void;
  onDelete: () => void;
}) {
  const slotNames = [...new Set(flow.stages.flatMap((s) => s.collect.map((c) => c.name)).filter(Boolean))];
  const duplicateCode = flow.stages.some((s) => s.id !== stage.id && s.code === stage.code);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Field label="Code">
          <input
            value={stage.code}
            onChange={(e) => onChange({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
            className={`w-20 font-label ${fieldInput}`}
          />
        </Field>
        <div className="flex-1">
          <Field label="Name">
            <input value={stage.name} onChange={(e) => onChange({ name: e.target.value })} className={input} />
          </Field>
        </div>
      </div>
      {duplicateCode && (
        <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">Another stage already uses code {stage.code}.</p>
      )}
      <Field label="Goal" hint="What this stage must achieve — one sentence.">
        <textarea value={stage.goal} onChange={(e) => onChange({ goal: e.target.value })} className={textarea} />
      </Field>
      <Field label="Information to collect" hint="Required items must be collected before the goal can be met.">
        <SlotRows slots={stage.collect} onChange={(collect) => onChange({ collect })} />
      </Field>
      <Field label="Instructions" hint="How the agent should approach it — tone, order, what to say.">
        <textarea
          value={stage.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          className={`${textarea} min-h-[88px]`}
        />
      </Field>
      <Field label="Steering" hint="How firmly to bring an off-topic caller back.">
        <select
          value={stage.steering}
          onChange={(e) => onChange({ steering: e.target.value as Steering })}
          className={input}
        >
          {STEERING.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Exits" hint="Where the conversation can go next.">
        <ExitRows exits={stage.exits} stages={flow.stages} allowOnComplete onChange={(exits) => onChange({ exits })} />
      </Field>
      <Field label="TouchDesigner cues">
        <CueRows cues={stage.cues} slotNames={slotNames} stageOnly onChange={(cues) => onChange({ cues })} />
      </Field>
      <button onClick={onDelete} className="self-start font-label text-[11px] uppercase tracking-widest text-[#b91c1c] hover:underline">
        Delete this stage
      </button>
    </div>
  );
}

export function MasterEditor({ flow, onChange }: { flow: AgentFlow; onChange: (patch: Partial<AgentFlow>) => void }) {
  const slotNames = [...new Set(flow.stages.flatMap((s) => s.collect.map((c) => c.name)).filter(Boolean))];
  return (
    <div className="flex flex-col gap-4">
      <Field label="Persona" hint="Who the agent is and how it sounds — applies everywhere.">
        <textarea value={flow.persona} onChange={(e) => onChange({ persona: e.target.value })} className={textarea} />
      </Field>
      <Field label="Rules" hint="Apply in every stage. One per line works well.">
        <textarea
          value={flow.rules}
          onChange={(e) => onChange({ rules: e.target.value })}
          className={`${textarea} min-h-[140px]`}
        />
      </Field>
      <Field label="Exits from any stage" hint="e.g. an emergency at any point.">
        <ExitRows
          exits={flow.globalExits}
          stages={flow.stages}
          allowOnComplete={false}
          onChange={(globalExits) => onChange({ globalExits })}
        />
      </Field>
      <Field label="Cues for the whole flow">
        <CueRows cues={flow.globalCues} slotNames={slotNames} stageOnly={false} onChange={(globalCues) => onChange({ globalCues })} />
      </Field>
      <Field label="TouchDesigner address" hint="Leave blank to just show cues in the inspector.">
        <input
          value={flow.tdUrl}
          onChange={(e) => onChange({ tdUrl: e.target.value })}
          placeholder="http://localhost:9980/trigger"
          className={`${input} font-label`}
        />
      </Field>
    </div>
  );
}
