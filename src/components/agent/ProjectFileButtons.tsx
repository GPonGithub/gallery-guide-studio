'use client';

import { useRef, useState } from 'react';
import { buttonBusy, buttonOutline } from '@/lib/styles';
import { exportProject, importProject, readProjectFile } from '@/lib/projectBackup';
import { currentTeam } from '@/lib/team';
import { Spinner } from './Spinner';

/**
 * Export Project / Import Project (top right, after Saved): the whole of this team's work in this
 * browser as one file, and back (see projectBackup.ts).
 */
export function ProjectFileButtons() {
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportProject();
    } catch (err) {
      window.alert(err instanceof Error ? `The project couldn’t be exported: ${err.message}` : 'The project couldn’t be exported.');
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (file: File) => {
    try {
      const project = await readProjectFile(file);
      const ok = window.confirm(
        `Open “${file.name}”${project.team !== currentTeam() ? ` (exported from Team ${project.team})` : ''}?\n\n` +
          `It replaces everything Team ${currentTeam()} has in this browser — every scene, conversation, voice, music file, ` +
          'patient, media connection and setting. Export Project first if you want to keep what’s here.\n\n' +
          'Your API keys stay as they are. Afterwards, choose the media folder again (Adding Immersive Media → 1).',
      );
      if (ok) await importProject(project);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'That project couldn’t be opened.');
    }
  };

  // Stacked — Import over Export — each about half a header button's height, 5px apart.
  const half = (cls: string) =>
    `${cls.replace('py-2', 'py-0').replace('px-4', 'px-2').replace('text-[11px]', 'text-[10px]')} inline-flex h-[18px] w-[150px] items-center justify-center gap-1.5 whitespace-nowrap leading-none`;
  const importButton = (
    <button
      onClick={() => input.current?.click()}
      className={half(buttonOutline)}
      title="Open an exported project — it replaces this team's work in this browser"
    >
      Import Project
    </button>
  );
  return (
    <div className="flex flex-col gap-[5px]">
      {importButton}
      <button
        onClick={() => void doExport()}
        disabled={exporting}
        className={half(exporting ? buttonBusy : buttonOutline)}
        title="Download everything — scenes, conversations, voices, music, patients, media connections and settings — to carry on later or on another computer (API keys are left out)"
      >
        {exporting && <Spinner />}
        {exporting ? 'Exporting…' : 'Export Project'}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void doImport(f);
        }}
      />
    </div>
  );
}
