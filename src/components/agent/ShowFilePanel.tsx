'use client';

import { useRef, useState } from 'react';
import { updateMediaLinks, type MediaFolder, type StoredLibrary } from '@/lib/agent/mediaFolder';
import { connectionsFrom, parseShow, SHOW_FILE_NAME } from '@/lib/agent/showFile';
import { downloadShow, saveShowToFolder, useShowSaveStatus } from '@/lib/agent/showSave';

const button = (busy = false) =>
  `h-9 w-[190px] border border-ink px-2 font-label text-[10px] uppercase leading-none tracking-wide transition-colors ${
    busy ? 'cursor-wait bg-paper text-muted-ink' : 'bg-paper text-ink hover:bg-ink hover:text-paper'
  }`;

/**
 * Adding Immersive Media, section 3: the show file — show.json in the media
 * folder, kept up to date as you work (see showSave.ts), which TouchDesigner
 * and Greg's Show Control read. Save a Copy downloads it; Open Show reads one
 * back (its connections replace those of the scenes it covers — undoable).
 */
export function ShowFilePanel({ folder, library }: { folder: MediaFolder | null; library: StoredLibrary | null }) {
  const status = useShowSaveStatus();
  const [note, setNote] = useState<{ text: string; problem?: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = async (file: File) => {
    setNote(null);
    try {
      const show = parseShow(await file.text());
      const { links, unmatched } = connectionsFrom(show, library?.assets ?? []);
      const scenes = new Set(show.connections.map((c) => `${c.sheetId}#${c.sceneNumber}`));
      const ok = window.confirm(
        `Open “${file.name}”? Its ${links.length} connection${links.length === 1 ? '' : 's'} replace the connections of the ${scenes.size} scene${scenes.size === 1 ? '' : 's'} it covers. (⌘Z undoes this.)`,
      );
      if (!ok) return;
      updateMediaLinks(
        (all) => [...all.filter((l) => !scenes.has(`${l.sheetId}#${l.sceneNumber}`)), ...links],
        'Open show',
      );
      setNote(
        unmatched.length
          ? {
              text: `Opened. ${unmatched.length} file${unmatched.length === 1 ? ' isn’t' : 's aren’t'} in your media folder: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '…' : ''}`,
              problem: true,
            }
          : { text: `✓ Opened “${file.name}”.` },
      );
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'That file couldn’t be opened.', problem: true });
    }
  };

  const line =
    !folder || status.state === 'off'
      ? { text: 'Choose the media folder first (1 · Media folder) — the show file is saved there.' }
      : status.state === 'needs-permission'
        ? { text: 'Not saved yet: the browser needs your permission to save into the media folder.', problem: true }
        : status.state === 'saving'
          ? { text: 'Saving…' }
          : status.state === 'saved'
            ? { text: `✓ Saved as ${SHOW_FILE_NAME} in “${folder.name}” · ${new Date(status.at).toLocaleTimeString()}` }
            : { text: status.message, problem: true };

  return (
    <div className="flex flex-col gap-2" data-tour="show-file">
      <p className="font-body text-xs italic text-muted-ink">
        Everything you connect is saved as <b>{SHOW_FILE_NAME}</b> in your media folder, beside the files it lists —
        TouchDesigner and Show Control read it from there. Save a copy to share or hand in; open one to bring its
        connections back.
      </p>
      <p
        className={`font-body text-xs ${line.problem ? 'border-l-4 border-[#b91c1c] pl-2 text-ink' : 'text-muted-ink'}`}
        role="status"
      >
        {line.text}
      </p>
      {folder && status.state === 'needs-permission' && (
        <button onClick={() => void saveShowToFolder(folder, true)} className={button()}>
          Allow Saving
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void downloadShow()} className={button()}>
          Save a Copy
        </button>
        <button onClick={() => input.current?.click()} className={button()}>
          Open Show…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void open(file);
          }}
        />
      </div>
      {note && (
        <p className={`font-body text-xs text-ink ${note.problem ? 'border-l-4 border-[#b91c1c] pl-2' : ''}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
