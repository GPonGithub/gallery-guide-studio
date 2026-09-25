'use client';

import { useState } from 'react';
import type { PlaybookBox, PlaybookStep, StepOption } from '@/lib/types';
import { buttonOutline, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';
import { designerId as computeDesignerId } from '@/lib/designerId';

// One blank "add next" row past the last real step, minimum 3 shown for an
// empty box — no fixed ceiling, so a box can grow to however many steps a
// real dialogue needs (up to ~20-25 boxes across a full flow, some well
// past what a fixed 10-row table could hold).
const MIN_ROWS = 3;
const OPTIONS: StepOption[] = ['BOT', 'USER', 'NAV'];

function makeStepId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const cellInput = `${fieldInput} w-full px-2 py-1.5 text-[13px]`;

type Props = {
  box: PlaybookBox;
  /** This box's position among all boxes — fallback header/Designer-ID numbering for a box that's never synced (no `box.code` yet). */
  boxIndex: number;
  allBoxes: PlaybookBox[];
  designerInitials: string;
  onChange: (steps: PlaybookStep[]) => void;
  onChangeInstructionPrompt: (instructionPrompt: string) => void;
  /** Returns the freshly generated steps (or null on failure) — the modal stages them as a draft; Save is still required to commit. */
  onGeneratePrompt: () => Promise<PlaybookStep[] | null>;
  onClose: () => void;
};

// Edits here are a local draft, not applied live — nothing reaches the app
// (or counts toward "Update FigJam file" being enabled) until Save. Cancel
// discards the draft entirely, closing with the box untouched.
export function PlaybookEditorModal({
  box, boxIndex, allBoxes, designerInitials, onChange, onChangeInstructionPrompt, onGeneratePrompt, onClose,
}: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(box.instructionPrompt);
  const [draftSteps, setDraftSteps] = useState<PlaybookStep[]>(box.steps);

  const steps = draftSteps;
  const displayCode = box.code || String(boxIndex + 1);
  const rowCount = Math.max(steps.length + 1, MIN_ROWS);

  const otherBoxes = allBoxes.filter((b) => b.id !== box.id);
  // Real Figma-connector neighbors first (if any), then everything else —
  // just prioritizing the picker, not restricting it.
  const targetChoices = box.leadsTo?.length
    ? [
        ...box.leadsTo.map((id) => otherBoxes.find((b) => b.id === id)).filter((b): b is PlaybookBox => Boolean(b)),
        ...otherBoxes.filter((b) => !box.leadsTo?.includes(b.id)),
      ]
    : otherBoxes;

  const updateStep = (index: number, patch: Partial<PlaybookStep>) => {
    setDraftSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const setOption = (index: number, option: StepOption) => {
    // Switching type drops fields that don't apply to the new one, rather
    // than carrying stale data (a leftover navTarget on a step that's no
    // longer NAV, etc).
    updateStep(index, {
      option,
      navTarget: option === 'NAV' ? steps[index]?.navTarget : undefined,
      variable: option === 'USER' ? steps[index]?.variable : undefined,
    });
  };

  const addStep = (option: StepOption) => {
    const newStep: PlaybookStep = { id: makeStepId(), option, instruction: '' };
    setDraftSteps([...steps, newStep]);
  };

  const removeStep = (index: number) => {
    setDraftSteps(steps.filter((_, i) => i !== index));
  };

  const handleGeneratePrompt = async () => {
    setIsGenerating(true);
    try {
      const generated = await onGeneratePrompt();
      if (generated) setDraftSteps(generated);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    onChange(draftSteps);
    onChangeInstructionPrompt(draftPrompt);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-6xl flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">
            PLAYBOOK {displayCode} : {box.label.toUpperCase()}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
          Prompt
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="Describe what this playbook should do — this is what Regenerate steps builds the table from."
            className={`h-20 w-full resize-none normal-case tracking-normal ${fieldInput}`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleGeneratePrompt} disabled={isGenerating} className={buttonOutline}>
            {isGenerating ? 'Generating…' : 'Regenerate steps'}
          </button>
          <span className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
            Rebuilds this playbook&rsquo;s step table from the prompt above, using your master playbook and any
            other playbooks as reference — still just a draft until you click Save.
          </span>
        </div>

        <div className="overflow-x-auto border-2 border-ink">
          <table className="w-full min-w-[960px] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink bg-muted">
                {['STEP', 'BOT / USER / NAV', 'INSTRUCTION', 'VARIABLE', 'SEND TO TD', 'SAVE TO SHEET', 'DESIGNER ID'].map(
                  (h) => (
                    <th key={h} className="border-r border-hair px-2 py-2 font-label text-[10px] uppercase tracking-widest text-ink last:border-r-0">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }, (_, i) => {
                const step = steps[i];
                const isNextBlank = i === steps.length;
                const isInert = i > steps.length;
                const designerId = computeDesignerId(designerInitials, displayCode, i + 1);

                return (
                  <tr key={step?.id ?? `blank-${i}`} className="border-b border-hair align-top last:border-b-0">
                    <td className="border-r border-hair px-2 py-2 font-body text-sm text-ink">{i + 1}</td>

                    <td className="border-r border-hair px-2 py-2">
                      {step ? (
                        <select
                          value={step.option}
                          onChange={(e) => setOption(i, e.target.value as StepOption)}
                          className={cellInput}
                        >
                          {OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : isNextBlank ? (
                        <select
                          value=""
                          onChange={(e) => e.target.value && addStep(e.target.value as StepOption)}
                          className={cellInput}
                        >
                          <option value="">—</option>
                          {OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>

                    <td className="border-r border-hair px-2 py-2">
                      {step && (
                        <div className="flex flex-col gap-1.5">
                          <input
                            value={step.instruction}
                            onChange={(e) => updateStep(i, { instruction: e.target.value })}
                            placeholder={
                              step.option === 'BOT'
                                ? 'What should the agent say?'
                                : step.option === 'USER'
                                  ? 'What is the visitor answering?'
                                  : 'When should this branch apply?'
                            }
                            className={cellInput}
                          />
                          {step.option === 'NAV' && (
                            <select
                              value={step.navTarget ?? ''}
                              onChange={(e) => updateStep(i, { navTarget: e.target.value || undefined })}
                              className={cellInput}
                            >
                              <option value="">Go to…</option>
                              {targetChoices.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="border-r border-hair px-2 py-2">
                      {step && (
                        <input
                          value={step.variable ?? ''}
                          onChange={(e) => updateStep(i, { variable: e.target.value || undefined })}
                          disabled={step.option !== 'USER'}
                          placeholder={step.option === 'USER' ? 'variable_name' : ''}
                          className={`${cellInput} disabled:bg-muted disabled:text-muted-ink`}
                        />
                      )}
                    </td>

                    <td className="border-r border-hair px-2 py-2 text-center">
                      {step && (
                        <input
                          type="checkbox"
                          checked={Boolean(step.sendToTD)}
                          onChange={(e) => updateStep(i, { sendToTD: e.target.checked })}
                          className="accent-ink"
                        />
                      )}
                    </td>

                    <td className="border-r border-hair px-2 py-2 text-center">
                      {step && (
                        <input
                          type="checkbox"
                          checked={Boolean(step.saveToSheet)}
                          onChange={(e) => updateStep(i, { saveToSheet: e.target.checked })}
                          className="accent-ink"
                        />
                      )}
                    </td>

                    <td className="px-2 py-2">
                      {step && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-label text-[11px] tracking-wide text-muted-ink">{designerId}</span>
                          <button
                            onClick={() => removeStep(i)}
                            title="Delete this step"
                            className="px-1 text-base leading-none text-muted-ink transition-colors duration-100 hover:text-ink"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      {isInert && <span className="font-label text-[11px] text-hair">{designerId}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={buttonOutline}>
            Cancel
          </button>
          <button onClick={handleSave} className={buttonPrimary}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
