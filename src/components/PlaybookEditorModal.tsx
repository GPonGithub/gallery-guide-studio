'use client';

import { useState } from 'react';
import type { PlaybookBox } from '@/lib/types';
import { buttonOutline, buttonPrimary, fieldInput } from '@/lib/styles';

type Props = {
  box: PlaybookBox;
  onChange: (instructions: string) => void;
  onGeneratePrompt: () => Promise<void>;
  onClose: () => void;
};

const BASIC_INSTRUCTIONS_TEMPLATE = `## Personality
1.

## Flow
1.

## Rules
1.

## Edge cases
1.`;

export function PlaybookEditorModal({ box, onChange, onGeneratePrompt, onClose }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);

  const addBasicInstructions = () => {
    const existing = box.instructions.trim();
    onChange(existing ? `${box.instructions}\n\n${BASIC_INSTRUCTIONS_TEMPLATE}` : BASIC_INSTRUCTIONS_TEMPLATE);
  };

  const handleGeneratePrompt = async () => {
    setIsGenerating(true);
    try {
      await onGeneratePrompt();
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-5xl flex-col gap-4 border-2 border-ink bg-paper p-6">
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

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addBasicInstructions} className={buttonOutline}>
            + Basic instructions
          </button>
          <button onClick={handleGeneratePrompt} disabled={isGenerating} className={buttonPrimary}>
            {isGenerating ? 'Generating…' : 'Generate prompt'}
          </button>
          <span className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
            Generate prompt updates only this playbook, using your master playbook and any others as reference.
          </span>
        </div>

        <textarea
          autoFocus
          value={box.instructions}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What should the agent do at this stage? Be specific about tone, goals, and what to say."
          className={`h-[560px] w-full resize-none ${fieldInput}`}
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
