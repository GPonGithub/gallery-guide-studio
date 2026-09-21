'use client';

import { buttonPrimary, fieldInput } from '@/lib/styles';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

export function MasterPlaybookModal({ value, onChange, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Master playbook</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="font-body text-sm italic text-muted-ink">
          Overall context — role, goals, tone, rules — that applies across every stage. Not step-by-step content.
        </p>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. You are a friendly museum guide named Sam. Always stay in character. Keep replies brief."
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
