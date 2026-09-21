'use client';

import type { PlaybookBox } from '@/lib/types';
import { buttonPrimary, fieldInput } from '@/lib/styles';

type Props = {
  box: PlaybookBox;
  onChange: (instructions: string) => void;
  onClose: () => void;
};

export function PlaybookEditorModal({ box, onChange, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Playbook — {box.label}</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <textarea
          autoFocus
          value={box.instructions}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What should the agent do at this stage? Be specific about tone, goals, and what to say."
          className={`h-56 w-full resize-none ${fieldInput}`}
        />
        <div className="flex justify-end">
          <button onClick={onClose} className={buttonPrimary}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
