'use client';

import { useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import { buttonOutline, buttonPrimary } from '@/lib/styles';
import { designerId } from '@/lib/designerId';

type Props = {
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  activeStepIndex: number;
  designerInitials: string;
  onClose: () => void;
};

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
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function FlowSnapshotModal({ boxes, activeBoxId, activeStepIndex, designerInitials, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const snapshotText = buildSnapshotText(boxes, activeBoxId, activeStepIndex, designerInitials);

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
