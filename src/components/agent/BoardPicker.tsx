'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cleanBoards, FIGJAM_BOARDS, isBoardUrl, nameFromBoardUrl, type FigjamBoard } from '@/lib/figjamBoards';
import { buttonOutline, buttonSaved, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';
import { DropdownArrow } from './DropdownArrow';

/**
 * Choosing the FigJam board: from the saved list (see lib/figjamBoards.ts),
 * or by pasting any board link — then confirming it with "Select This Board".
 * On the computer running the app the list can be edited and saved, into the
 * project's own files (src/data/figjamBoards.json), so it goes with every
 * copy of the app.
 */
export function BoardPicker({
  boardUrl,
  onBoardUrlChange,
  buttonClass,
  below,
}: {
  boardUrl: string;
  onBoardUrlChange: (url: string) => void;
  /** Size of the Select This Board / Board Selected button (to match buttons stacked under it). */
  buttonClass?: string;
  /** Shown straight under the Board Selected button (before the board-list editor). */
  below?: ReactNode;
}) {
  const [boards, setBoards] = useState<FigjamBoard[]>(FIGJAM_BOARDS);
  const [editable, setEditable] = useState(false);
  const [draft, setDraft] = useState<FigjamBoard[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/figjam-boards')
      .then((res) => res.json() as Promise<{ boards: FigjamBoard[]; editable: boolean }>)
      .then((data) => {
        setBoards(data.boards);
        setEditable(data.editable);
      })
      .catch(() => {
        // Offline or blocked: the list built into the app still works.
      });
  }, []);

  // Blank rows don't count as changes; names left empty count as the name the link gives.
  const draftChanged = draft !== null && JSON.stringify(cleanBoards(draft) ?? draft) !== JSON.stringify(boards);
  const badRows = draft?.map((b) => (b.url.trim() !== '' || b.name.trim() !== '') && !isBoardUrl(b.url)) ?? [];

  const save = async () => {
    if (!draft) return;
    const clean = cleanBoards(draft);
    if (!clean) return setError('Every link must be a FigJam board link (https://www.figma.com/board/…).');
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/figjam-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boards: clean }),
      });
      const data = (await res.json()) as { boards: FigjamBoard[] } | { error: string };
      if ('error' in data) throw new Error(data.error);
      setBoards(data.boards);
      setDraft(data.boards);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The list could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const updateRow = (i: number, patch: Partial<FigjamBoard>) =>
    setDraft((d) => d && d.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="flex flex-col gap-2">
      {/* Keyed by the board in use, so it starts from that board whenever it changes. */}
      <BoardChooser key={boardUrl} boards={boards} boardUrl={boardUrl} onSelect={onBoardUrlChange} buttonClass={buttonClass} />
      {below}

      {/* Folded away by default; unsaved changes are kept while it's folded. */}
      {editable && (
        // About 100px of space (with the 8px gap) sets editing the list apart from choosing a board.
        <div className="mt-[92px] border-2 border-ink">
          <button
            onClick={() => {
              if (!editorOpen && draft === null) setDraft(boards.length ? boards : [{ name: '', url: '' }]);
              setEditorOpen((o) => !o);
            }}
            aria-expanded={editorOpen}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
          >
            <span className={fieldLabel}>
              Board List Editor (for use by instructor only){draftChanged ? ' · unsaved changes' : ''}
            </span>
            <DropdownArrow open={editorOpen} className="text-ink" />
          </button>
        </div>
      )}

      {editable && editorOpen && draft !== null && (
        <div className="-mt-2 flex flex-col gap-2 border-2 border-t-0 border-ink p-3">
          {draft.map((b, i) => (
            <div key={i} className="flex flex-col gap-1 border-b border-hair pb-2">
              <div className="flex gap-2">
                <input
                  value={b.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  placeholder={nameFromBoardUrl(b.url) || 'Name shown in the list'}
                  aria-label={`Board ${i + 1} name`}
                  className={`min-w-0 flex-1 text-[13px] ${fieldInput}`}
                />
                <button
                  onClick={() => setDraft((d) => d && d.filter((_, j) => j !== i))}
                  className="px-2 font-label text-[10px] uppercase tracking-widest text-[#b91c1c] hover:underline"
                  aria-label={`Remove board ${i + 1}`}
                >
                  Remove
                </button>
              </div>
              <input
                value={b.url}
                onChange={(e) => updateRow(i, { url: e.target.value.trim() })}
                placeholder="https://www.figma.com/board/…"
                aria-label={`Board ${i + 1} link`}
                className={`w-full font-label text-[12px] ${fieldInput} ${badRows[i] ? 'border-[#b91c1c]' : ''}`}
              />
              {badRows[i] && <p className="font-body text-xs text-[#b91c1c]">Not a FigJam board link.</p>}
            </div>
          ))}
          <button onClick={() => setDraft((d) => [...(d ?? []), { name: '', url: '' }])} className={`self-start ${buttonOutline}`}>
            + Add a board
          </button>
          {error && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">{error}</p>}
          <div className="flex gap-2 border-t-2 border-ink pt-2">
            {/* Red while there are unsaved changes; green once saved. */}
            <button
              onClick={() => void save()}
              disabled={saving || !draftChanged || badRows.some(Boolean)}
              className={draftChanged ? buttonUnsaved : buttonSaved}
            >
              {saving ? 'Saving…' : draftChanged ? 'Save list' : 'Saved'}
            </button>
            {draftChanged && (
              <button
                onClick={() => {
                  setDraft(boards.length ? boards : [{ name: '', url: '' }]);
                  setError('');
                }}
                className={buttonOutline}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const OWN = 'own';

/**
 * Choose Board → Select This Board → Board Selected. Nothing changes the
 * board in use until it's confirmed; changing the choice (or the pasted
 * link) turns the button back from green until it's confirmed again.
 */
function BoardChooser({
  boards,
  boardUrl,
  onSelect,
  buttonClass,
}: {
  boards: FigjamBoard[];
  boardUrl: string;
  onSelect: (url: string) => void;
  buttonClass?: string;
}) {
  const inUse = boards.find((b) => b.url === boardUrl);
  const [choice, setChoice] = useState(inUse ? inUse.url : boardUrl ? OWN : '');
  const [pasted, setPasted] = useState(inUse ? '' : boardUrl);
  const chosen = boards.find((b) => b.url === choice);
  const pending = choice === OWN ? pasted.trim() : (chosen?.url ?? '');
  const valid = pending !== '' && isBoardUrl(pending);
  const selected = valid && pending === boardUrl;

  return (
    <div className="flex flex-col gap-2" data-tour="choose-board">
      <label className={`flex flex-col gap-1 ${fieldLabel}`}>
        Choose Board
        <span className="relative flex items-center">
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="h-10 w-full cursor-pointer appearance-none border border-ink bg-transparent pl-2 pr-8 font-label text-[12px] normal-case tracking-normal text-ink hover:bg-muted/60"
          >
            <option value="">None</option>
            <option value={OWN}>Your own board</option>
            {boards.length > 0 && (
              <optgroup label="Saved boards">
                {boards.map((b) => (
                  <option key={b.url} value={b.url}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <DropdownArrow className="pointer-events-none absolute right-2 text-ink" />
        </span>
      </label>

      {choice !== '' && (
        <div className="flex flex-col items-start gap-2">
          {choice === OWN ? (
            <label className={`flex w-full min-w-0 flex-col gap-1 ${fieldLabel}`}>
              Paste a Board Link
              <input
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="https://www.figma.com/board/…"
                aria-invalid={pasted.trim() !== '' && !valid}
                className={`w-full font-label text-[12px] normal-case tracking-normal ${fieldInput} ${
                  pasted.trim() !== '' && !valid ? 'border-[#b91c1c]' : ''
                }`}
              />
            </label>
          ) : (
            <p className="w-full min-w-0 truncate font-body text-sm text-ink">{chosen?.name}</p>
          )}
          {/* Inactive until there's a valid board; green once it's the board in use. */}
          <button
            onClick={() => onSelect(pending)}
            disabled={!valid || selected}
            className={`${buttonClass ?? 'h-10 shrink-0'} ${selected ? buttonSaved : buttonOutline}`}
          >
            {selected ? 'Board Selected' : 'Select This Board'}
          </button>
        </div>
      )}
      {choice === OWN && pasted.trim() !== '' && !valid && (
        <p className="font-body text-xs text-[#b91c1c]">That isn&rsquo;t a FigJam board link.</p>
      )}
      {/* While a different choice waits to be confirmed, the board still in use is named. */}
      {boardUrl && !selected && (
        <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
          In use: {inUse ? inUse.name : nameFromBoardUrl(boardUrl) || boardUrl}
        </p>
      )}
    </div>
  );
}
