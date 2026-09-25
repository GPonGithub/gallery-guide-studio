'use client';

import type { PlaybookBox } from '@/lib/types';
import { buttonPrimary } from '@/lib/styles';

type Props = {
  boxes: PlaybookBox[];
  onSelectBox: (id: string) => void;
  onClose: () => void;
};

// The reliable way to open a specific playbook's editor — no Figma
// rendering, no click-position math, just the box list the app already has
// in state (auto-populated by Sync/Reset from Figma). Click a row, get the
// editor for that exact playbook.
export function EditPlaybooksModal({ boxes, onSelectBox, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <div>
            <h2 className="font-display text-xl tracking-tight text-ink">Edit playbooks</h2>
            <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
              {boxes.length} playbook{boxes.length === 1 ? '' : 's'} detected
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
          <ul className="flex flex-col divide-y divide-hair overflow-y-auto border-2 border-ink">
            {boxes.map((box, i) => (
              <li key={box.id}>
                <button
                  onClick={() => {
                    onSelectBox(box.id);
                    onClose();
                  }}
                  className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-ink"
                >
                  <span className="w-10 shrink-0 font-label text-[10px] uppercase tracking-widest text-muted-ink group-hover:text-paper/70">
                    {box.code || String(i + 1)}
                  </span>
                  <span className="flex-1 truncate font-body text-sm text-ink group-hover:text-paper">
                    {box.label || 'Untitled'}
                  </span>
                  <span className="shrink-0 font-label text-[10px] uppercase tracking-widest text-muted-ink group-hover:text-paper/70">
                    {box.steps.length} step{box.steps.length === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className={buttonPrimary}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
