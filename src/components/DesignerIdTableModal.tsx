'use client';

import type { PlaybookBox } from '@/lib/types';
import { buttonPrimary } from '@/lib/styles';
import { designerId } from '@/lib/designerId';

type Props = {
  boxes: PlaybookBox[];
  designerInitials: string;
  onClose: () => void;
};

export function DesignerIdTableModal({ boxes, designerInitials, onClose }: Props) {
  const rows = boxes.flatMap((box, boxIndex) =>
    box.steps.map((step, stepIndex) => ({
      designerId: designerId(designerInitials, box.code || String(boxIndex + 1), stepIndex + 1),
      playbook: box.label,
      step: stepIndex + 1,
      option: step.option,
      instruction: step.instruction,
      variable: step.variable ?? '',
    })),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-6xl flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <div>
            <h2 className="font-display text-xl tracking-tight text-ink">Designer ID table</h2>
            <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
              Live view, computed from every playbook&rsquo;s current steps — nothing stored separately yet. Export
              to a file is a later step, not built here.
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

        <div className="overflow-auto border-2 border-ink">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="sticky top-0 bg-paper">
              <tr className="border-b-2 border-ink bg-muted">
                {['Designer ID', 'Playbook', 'Step', 'Option', 'Instruction', 'Variable'].map((h) => (
                  <th key={h} className="border-r border-hair px-2 py-2 font-label text-[10px] uppercase tracking-widest text-ink last:border-r-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center font-label text-[11px] uppercase tracking-widest text-muted-ink">
                    No steps yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.designerId} className="border-b border-hair align-top last:border-b-0">
                    <td className="border-r border-hair px-2 py-2 font-label text-[11px] tracking-wide text-ink">{r.designerId}</td>
                    <td className="border-r border-hair px-2 py-2 font-body text-sm text-ink">{r.playbook}</td>
                    <td className="border-r border-hair px-2 py-2 font-body text-sm text-ink">{r.step}</td>
                    <td className="border-r border-hair px-2 py-2 font-body text-sm text-ink">{r.option}</td>
                    <td className="border-r border-hair px-2 py-2 font-body text-sm text-ink">{r.instruction}</td>
                    <td className="px-2 py-2 font-body text-sm text-ink">{r.variable}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className={buttonPrimary}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
