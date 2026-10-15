'use client';

import { buttonDanger, buttonOutline } from '@/lib/styles';

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before doing something that can't be undone. Cancel is the safe
 * default: it has the focus (so Enter cancels), and Escape or a click
 * outside the dialog cancel too — only the red button goes ahead.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Reset', onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4"
      // Clicks here never reach whatever this dialog sits on top of.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="flex w-full max-w-md flex-col gap-4 border-2 border-ink bg-paper p-6"
      >
        <h2 id="confirm-dialog-title" className="font-display text-xl tracking-tight text-ink">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="font-body text-sm text-ink">
          {message}
        </p>
        <div className="flex justify-end gap-2 border-t-2 border-ink pt-4">
          {/* Focused first: the safe choice is the one Enter picks. */}
          <button onClick={onCancel} className={buttonOutline} autoFocus>
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
