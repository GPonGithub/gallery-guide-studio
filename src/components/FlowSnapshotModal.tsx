'use client';

import { useEffect, useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import type { FlowPlans } from '@/lib/flowPlan';
import { buttonOutline, buttonPrimary } from '@/lib/styles';
import { designerId } from '@/lib/designerId';

type Props = {
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  activeStepIndex: number;
  designerInitials: string;
  smartJumps: boolean;
  anthropicApiKey: string;
  onClose: () => void;
};

type PlanState = { status: 'off' | 'loading' | 'ready' | 'error'; plans: FlowPlans; failed: number };

// A readable, structured stand-in for "what's actually in the FigJam
// board right now" — built from the app's own synced data (accurate,
// no OCR/vision needed) rather than a picture of the live embed, which
// can't be read or drawn on from this app anyway. The point is debugging:
// when a test conversation stalls or takes a wrong turn, this shows
// exactly which playbook and step that corresponds to, in context.
function buildSnapshotText(
  boxes: PlaybookBox[],
  activeBoxId: string | null,
  activeStepIndex: number,
  designerInitials: string,
  planState: PlanState,
): string {
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const lines: string[] = [];
  boxes.forEach((box, boxIndex) => {
    const displayCode = box.code || String(boxIndex + 1);
    const isActiveBox = box.id === activeBoxId;
    lines.push(`PLAYBOOK ${displayCode}: ${box.label.toUpperCase()}${isActiveBox ? '   ◀ ACTIVE PLAYBOOK' : ''}`);
    if (box.instructionPrompt) lines.push(`  Prompt: ${box.instructionPrompt}`);
    if (box.steps.length === 0) lines.push('  (no steps yet)');
    box.steps.forEach((step, stepIndex) => {
      const isHere = isActiveBox && stepIndex === activeStepIndex;
      const target = step.navTarget ? boxById.get(step.navTarget) : undefined;
      const targetText = target ? ` → Playbook ${target.code || '?'}: ${target.label}` : '';
      const variableText = step.variable ? ` [saves: ${step.variable}]` : '';
      const id = designerId(designerInitials, displayCode, stepIndex + 1);
      lines.push(
        `  ${stepIndex + 1}. [${id}] ${step.option}: ${step.instruction}${variableText}${targetText}${isHere ? '   ◀ CURRENT POSITION' : ''}`,
      );
    });
    const loops = box.steps.some((s) => s.option === 'NAV' && s.navTarget === box.id);
    if (loops && planState.status !== 'off') {
      const plan = planState.plans[box.id];
      const stepNumber = (stepId: string) => box.steps.findIndex((s) => s.id === stepId) + 1;
      lines.push('  SMART JUMPS (worked out by Claude, because a branch points back to this playbook — check these):');
      if (planState.status === 'loading') lines.push('    Working them out…');
      else if (!plan) lines.push('    Couldn’t work these out — this playbook runs as written (those branches restart it at step 1).');
      else {
        plan.jumps.forEach((m) => lines.push(`    Step ${stepNumber(m.stepId)} → jumps to step ${m.toIndex + 1} — ${m.reason}`));
        plan.skips.forEach((m) =>
          lines.push(`    After step ${stepNumber(m.stepId)} → skips to step ${m.toIndex + 1} — ${m.reason}`),
        );
        if (plan.jumps.length === 0 && plan.skips.length === 0) lines.push('    None needed.');
      }
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function FlowSnapshotModal({
  boxes,
  activeBoxId,
  activeStepIndex,
  designerInitials,
  smartJumps,
  anthropicApiKey,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const canPlan = smartJumps && anthropicApiKey.trim() !== '';
  const [planState, setPlanState] = useState<PlanState>({ status: canPlan ? 'loading' : 'off', plans: {}, failed: 0 });
  const snapshotText = buildSnapshotText(boxes, activeBoxId, activeStepIndex, designerInitials, planState);

  // Same cache the chat uses, so this shows exactly what the conversation
  // will do — and usually comes back instantly once a chat has run.
  useEffect(() => {
    if (!canPlan) return;
    let cancelled = false;
    fetch('/api/flow-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes, anthropicApiKey }),
    })
      .then((res) => res.json() as Promise<{ plans: FlowPlans; failed: number }>)
      .then(({ plans, failed }) => !cancelled && setPlanState({ status: 'ready', plans, failed }))
      .catch(() => !cancelled && setPlanState({ status: 'error', plans: {}, failed: 0 }));
    return () => {
      cancelled = true;
    };
  }, [canPlan, boxes, anthropicApiKey]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(snapshotText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert('Could not copy automatically — select the text below and copy it by hand.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <div>
            <h2 className="font-display text-xl tracking-tight text-ink">Flow snapshot</h2>
            <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
              Every playbook and step, in order, with your current test position marked — for tracing exactly
              where a stalled or wrong-turn conversation actually is.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {boxes.length === 0 ? (
          <p className="font-label text-[11px] uppercase tracking-widest text-muted-ink">
            No playbooks yet — connect a FigJam file and sync first.
          </p>
        ) : (
          <pre className="overflow-auto whitespace-pre-wrap border-2 border-ink bg-muted p-4 font-body text-[13px] leading-relaxed text-ink">
            {snapshotText}
          </pre>
        )}

        <div className="flex items-center justify-between">
          <span className="font-label text-[10px] uppercase tracking-widest text-muted-ink">
            {activeBoxId ? 'Current position marked above' : 'No active playbook yet — say hello in the chat to start a test'}
          </span>
          <div className="flex gap-2">
            <button onClick={copyText} disabled={boxes.length === 0} className={buttonOutline}>
              {copied ? 'Copied!' : 'Copy as text'}
            </button>
            <button onClick={onClose} className={buttonPrimary}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
