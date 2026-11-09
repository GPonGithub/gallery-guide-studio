'use client';

import { useEffect, useState } from 'react';
import { startLocalBackup, useLocalBackup } from '@/lib/localBackup';

/**
 * Starts this computer's backup of the browser's work (see localBackup.ts) and, under the header, says
 * when the app was just put back from it — or that a copy couldn't be saved. Nothing shows otherwise.
 */
export function LocalBackupNote() {
  const { restoredFrom, problem } = useLocalBackup();
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    void startLocalBackup();
  }, []);

  if (closed || (!restoredFrom && !problem)) return null;
  return (
    <div
      role="status"
      className={`flex items-start gap-3 border-b-2 border-ink px-5 py-2 font-body text-xs text-ink ${problem ? 'bg-[#fde8e8]' : 'bg-muted'}`}
    >
      <p className="flex-1">
        {restoredFrom ? (
          <>
            This browser had forgotten your work, so it was put back from this computer&rsquo;s copy (saved{' '}
            {new Date(restoredFrom).toLocaleString()}). In <b>Adding Immersive Media → 1 · Media folder</b>, choose each
            scene&rsquo;s media folder again. Your API keys need typing again too (Keys).
            {problem && <span className="mt-1 block">{problem}</span>}
          </>
        ) : (
          problem
        )}
      </p>
      <button
        onClick={() => setClosed(true)}
        className="font-label text-[10px] uppercase tracking-wide underline"
        aria-label="Close this note"
      >
        Close
      </button>
    </div>
  );
}
