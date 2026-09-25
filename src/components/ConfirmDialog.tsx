'use client';

import { buttonDanger, buttonOutline } from '@/lib/styles';

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, message, confirmLabel = 'Reset', onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 border-2 border-ink bg-paper p-6">
        <h2 className="font-display text-xl tracking-tight text-ink">{title}</h2>
        <p className="font-body text-sm text-ink">{message}</p>
        <div className="flex justify-end gap-2 border-t-2 border-ink pt-4">
          <button onClick={onCancel} className={buttonOutline}>
            Cancel
          </button>
          <button onClick={onConfirm} className={buttonDanger}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
