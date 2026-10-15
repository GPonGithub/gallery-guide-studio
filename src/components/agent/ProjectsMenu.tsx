'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  moveServerProjectsHere,
  saveOrder,
  saveProject,
} from '@/lib/agent/localProjects';
import type { AgentProject, ProjectMusic, ProjectVoice } from '@/lib/agent/projectStore';
import type { AgentFlow } from '@/lib/agent/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { buttonOutline, buttonPrimary, buttonSaved, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';

// The Scenes dialog. A scene is what's open in the studio — flow, brief,
// FigJam board, voices and background music — saved under a name. (In the
// code it's still called a "project".) Scenes are numbered by their place
// in the list, which can be rearranged by dragging. They're kept in this
// browser; Export makes a file of one (to back it up, hand it in, or move
// computers).

const EXPANDED_KEY = 'goal-agent-scenes-expanded';

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export type CurrentProject = {
  id: string | null;
  name: string;
  dirty: boolean;
  flow: AgentFlow;
  brief: string;
  generatedBrief: string | null;
  boardUrl: string;
  voice: ProjectVoice;
  music: ProjectMusic | null;
  /** The music file itself, if this browser has it. */
  musicBlob: () => Promise<Blob | null>;
};

export function saveProjectRequest(current: CurrentProject, name: string, asNew: boolean): Promise<AgentProject> {
  return saveProject({
    id: asNew ? null : current.id,
    name,
    flow: current.flow,
    brief: current.brief,
    generatedBrief: current.generatedBrief,
    boardUrl: current.boardUrl,
    voice: current.voice,
    music: current.music,
    musicBlob: current.musicBlob,
    copyMusicFrom: asNew ? current.id : null,
  });
}

export function ProjectsMenu({
  current,
  onSaved,
  onOpen,
  onNew,
  onClose,
}: {
  current: CurrentProject;
  onSaved: (project: AgentProject) => void;
  onOpen: (project: AgentProject) => void;
  /** Starts a fresh, unsaved scene; false if the user chose to keep their unsaved work instead. */
  onNew: () => boolean;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<AgentProject[] | null>(null);
  const [name, setName] = useState(current.name);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // Where the not-yet-saved scene sits in the list (it's saved there).
  const [draftIndex, setDraftIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Full screen height, or the usual size — remembered in this browser.
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(EXPANDED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const importRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    try {
      await moveServerProjectsHere();
      setProjects(await listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load scenes.');
      setProjects([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the saved scenes when the dialog opens
    void refresh();
  }, []);

  const toggleExpanded = () => {
    setExpanded((was) => {
      try {
        window.localStorage.setItem(EXPANDED_KEY, was ? '0' : '1');
      } catch {
        // Not remembered — fine.
      }
      return !was;
    });
  };

  // The list as shown: the saved scenes plus — while what's open isn't saved as
  // a scene yet — a draft row for it, at the top unless it's been dragged.
  type Row = { kind: 'scene'; project: AgentProject } | { kind: 'draft' };
  const showDraft = current.id === null;
  const rows: Row[] | null = projects
    ? (() => {
        const list: Row[] = projects.map((project) => ({ kind: 'scene', project }));
        if (showDraft) list.splice(Math.min(draftIndex, list.length), 0, { kind: 'draft' });
        return list;
      })()
    : null;

  const save = async (asNew: boolean) => {
    if (!name.trim()) {
      setError('Give the scene a name first.');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const firstSave = !current.id && !asNew;
      const project = await saveProjectRequest(current, name.trim(), asNew);
      // A new scene is saved where its draft row is in the list.
      if (firstSave && rows) await saveOrder(rows.map((r) => (r.kind === 'draft' ? project.id : r.project.id)));
      onSaved(project);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // "Save" (red) until this is on disk as it stands, name included; then "Saved" (green).
  const unsaved = !current.id || current.dirty || name.trim() !== current.name;

  // The scene waiting for "Delete Scene" to be confirmed — nothing is deleted until then.
  const [toDelete, setToDelete] = useState<AgentProject | null>(null);
  const remove = async (project: AgentProject) => {
    setToDelete(null);
    await deleteProject(project.id);
    await refresh();
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const project = await importProject(file, (existing) =>
        window.confirm(`"${existing.name}" is already here. Replace it with the one in this file? (Cancel keeps both.)`),
      );
      await refresh();
      setError(null);
      setNotice(`Imported "${project.name}" — it's at the end of the list.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  // --- reordering ----------------------------------------------------------

  // Moves a row to a new place in the list and saves the new order (the draft
  // row's place is just remembered — it's saved there when the scene is).
  const move = (from: number, to: number) => {
    if (!rows || !projects || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const draftAt = next.findIndex((r) => r.kind === 'draft');
    if (draftAt >= 0) setDraftIndex(draftAt);
    const saved = next.flatMap((r) => (r.kind === 'scene' ? [r.project] : []));
    if (saved.some((p, i) => p.id !== projects[i]?.id)) {
      setProjects(saved);
      void saveOrder(saved.map((p) => p.id)).catch(() => setError('Couldn’t save the new order.'));
    }
  };

  // New blank scene: a draft row at the top, ready to be named right away.
  const startNew = () => {
    if (!onNew()) return;
    setName('');
    setDraftIndex(0);
    setError(null);
    setNotice(null);
    listRef.current?.scrollTo({ top: 0 });
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // What's being dragged: `from` its place to `to`, `offset` px from where it
  // started, and `gap` — how far the others move aside to make room.
  const [drag, setDrag] = useState<{ from: number; to: number; offset: number; gap: number } | null>(null);
  const dragInfo = useRef<{
    from: number;
    to: number;
    startY: number;
    startScroll: number;
    middles: number[];
    lastY: number;
    frame: number;
  } | null>(null);

  // Works out where the dragged scene would land, from the pointer's height.
  const follow = (clientY: number) => {
    const info = dragInfo.current;
    const list = listRef.current;
    if (!info || !list) return;
    info.lastY = clientY;
    const offset = clientY - info.startY + (list.scrollTop - info.startScroll);
    const centre = info.middles[info.from] + offset;
    let to = info.from;
    for (let i = info.from + 1; i < info.middles.length; i++) if (centre > info.middles[i]) to = i;
    for (let i = info.from - 1; i >= 0; i--) if (centre < info.middles[i]) to = i;
    info.to = to;
    setDrag((d) => (d ? { ...d, to, offset } : d));
  };

  const startDrag = (index: number, e: PointerEvent<HTMLElement>) => {
    const list = listRef.current;
    if (e.button !== 0 || !rows || !list) return;
    e.preventDefault();
    try {
      // Keeps the drag going even when the pointer leaves the handle.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer (e.g. a scripted test) — following still works on the handle.
    }
    // Row middles measured within the list's scrolled content, so scrolling mid-drag doesn't confuse them.
    const contentTop = list.getBoundingClientRect().top - list.scrollTop;
    const rects = rows.map((_, i) => rowRefs.current[i]?.getBoundingClientRect());
    const middles = rects.map((r) => (r ? r.top - contentTop + r.height / 2 : 0));
    dragInfo.current = { from: index, to: index, startY: e.clientY, startScroll: list.scrollTop, middles, lastY: e.clientY, frame: 0 };
    setDrag({ from: index, to: index, offset: 0, gap: rects[index]?.height ?? 0 });
    // Near the top or bottom of the list, keep scrolling it while held there.
    const tick = () => {
      const info = dragInfo.current;
      const el = listRef.current;
      if (!info || !el) return;
      const box = el.getBoundingClientRect();
      const edge = 48;
      const speed =
        info.lastY < box.top + edge
          ? -Math.ceil((box.top + edge - info.lastY) / 4)
          : info.lastY > box.bottom - edge
            ? Math.ceil((info.lastY - (box.bottom - edge)) / 4)
            : 0;
      if (speed) {
        el.scrollTop += speed;
        follow(info.lastY);
      }
      info.frame = requestAnimationFrame(tick);
    };
    dragInfo.current.frame = requestAnimationFrame(tick);
  };

  // Letting go of a drag over the dark backdrop must not count as a click on it (which closes the dialog).
  const justDragged = useRef(false);

  const endDrag = (commit: boolean) => {
    const info = dragInfo.current;
    if (!info) return;
    cancelAnimationFrame(info.frame);
    dragInfo.current = null;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    setDrag(null);
    if (commit) move(info.from, info.to);
  };

  // Arrow keys on the handle move a scene one place up or down.
  const keyMove = (index: number, e: KeyboardEvent<HTMLElement>) => {
    if (!rows) return;
    if (e.key === 'ArrowUp' && index > 0) move(index, index - 1);
    else if (e.key === 'ArrowDown' && index < rows.length - 1) move(index, index + 1);
    else return;
    e.preventDefault();
  };

  // While dragging: the dragged scene follows the pointer; the ones it passes
  // slide aside to open a gap where it will land.
  const rowStyle = (i: number): CSSProperties => {
    if (!drag) return {};
    if (i === drag.from) return { transform: `translateY(${drag.offset}px)`, position: 'relative', zIndex: 10 };
    let shift = 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.gap;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) shift = drag.gap;
    return { transform: `translateY(${shift}px)`, transition: 'transform 160ms ease' };
  };

  // Scene numbers follow the list — during a drag, as it will be when dropped.
  const numberOf = (i: number) => {
    if (!drag) return i + 1;
    if (i === drag.from) return drag.to + 1;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return i;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return i + 2;
    return i + 1;
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-ink/60 p-4 ${expanded ? 'items-stretch' : 'items-start pt-[8vh]'}`}
      onClick={() => !justDragged.current && onClose()}
    >
      <div
        className={`flex w-full max-w-[84rem] flex-col gap-4 overflow-y-auto border-2 border-ink bg-paper p-6 ${expanded ? 'h-full' : 'max-h-[84vh]'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Scenes</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleExpanded}
              aria-pressed={expanded}
              className="font-label text-[11px] uppercase tracking-widest text-ink hover:underline"
              title={expanded ? 'Back to the usual size' : 'Use the full height of the screen'}
            >
              {expanded ? '⤡ Shrink' : '⤢ Expand'}
            </button>
            <button onClick={onClose} className="text-xl leading-none text-ink hover:text-muted-ink" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <p className={fieldLabel}>
            {current.id ? 'This scene' : 'New scene — name it, then Save'}
            {current.id && (current.dirty ? ' · unsaved changes' : ' · saved')}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save(false)}
              placeholder="Scene name"
              aria-label="Scene name"
              className={`min-w-[220px] flex-1 ${fieldInput}`}
            />
            <button
              onClick={() => save(false)}
              disabled={saving}
              className={unsaved ? buttonUnsaved : buttonSaved}
              title={unsaved ? 'Save the scene' : 'Everything is saved — click to save again'}
            >
              {saving ? 'Saving…' : unsaved ? 'Save' : 'Saved'}
            </button>
            {current.id && (
              <button onClick={() => save(true)} disabled={saving} className={buttonOutline} title="Keep the original and save this as a separate scene">
                Save as copy
              </button>
            )}
          </div>
          {error && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{error}</p>}
          {notice && !error && <p className="border-l-4 border-[#15803d] pl-2 font-body text-sm text-ink">{notice}</p>}
        </section>

        <section className="flex min-h-56 flex-1 flex-col gap-2">
          <p className={fieldLabel}>
            Scenes{rows && rows.length > 1 ? ' · drag ⋮⋮ to reorder' : ''}
          </p>
          <div
            ref={listRef}
            // Always tall enough for a few scenes; on a very short screen the dialog itself scrolls.
            className={`min-h-48 flex-1 overflow-y-auto overscroll-contain border-t-2 border-ink ${expanded ? '' : 'max-h-[42vh]'}`}
          >
            {rows === null && <p className="py-3 font-body text-sm italic text-muted-ink">Loading…</p>}
            {rows?.length === 0 && <p className="py-3 font-body text-sm italic text-muted-ink">No saved scenes yet.</p>}
            {rows?.map((row, i) => {
              const dragging = drag?.from === i;
              const handle = (label: string) => (
                <button
                  onPointerDown={(e) => startDrag(i, e)}
                  onPointerMove={(e) => dragInfo.current && follow(e.clientY)}
                  onPointerUp={() => endDrag(true)}
                  onPointerCancel={() => endDrag(false)}
                  onKeyDown={(e) => keyMove(i, e)}
                  className={`touch-none select-none px-1 text-lg leading-none text-muted-ink hover:text-ink ${
                    dragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  aria-label={`Move scene ${i + 1}, ${label} — drag, or use the up and down arrow keys`}
                  title="Drag to reorder (or focus and use ↑ ↓)"
                >
                  ⋮⋮
                </button>
              );
              const rowClass = `flex flex-wrap items-center gap-3 border-b border-hair py-3 ${
                dragging ? 'cursor-grabbing border-2 border-ink shadow-[0_8px_20px_rgba(0,0,0,0.18)]' : ''
              }`;
              const setRef = (el: HTMLDivElement | null) => {
                rowRefs.current[i] = el;
              };

              // The scene that's open but not saved yet: its name follows the field above as you type.
              if (row.kind === 'draft') {
                const draftName = name.trim() || 'Untitled scene';
                return (
                  <div key="draft" ref={setRef} style={rowStyle(i)} className={`${rowClass} bg-[#fff6cc]`}>
                    {handle(draftName)}
                    <div className="min-w-[10rem] flex-1 select-none">
                      <p className="font-label text-[10px] uppercase tracking-widest text-muted-ink tabular-nums">
                        Scene {numberOf(i)} · open now · not saved yet
                      </p>
                      <p className={`truncate font-display text-base ${name.trim() ? 'text-ink' : 'text-muted-ink'}`}>{draftName}</p>
                      <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
                        Name it above and click Save — it&rsquo;s saved in this position
                      </p>
                    </div>
                  </div>
                );
              }

              const p = row.project;
              // The open scene shows the name being typed above, before it's saved.
              const shownName = p.id === current.id ? name.trim() || p.name : p.name;
              return (
                <div
                  key={p.id}
                  ref={setRef}
                  style={rowStyle(i)}
                  className={`${rowClass} bg-paper`}
                >
                  {handle(shownName)}
                  <div className="min-w-[10rem] flex-1 select-none">
                    <p className="font-label text-[10px] uppercase tracking-widest text-muted-ink tabular-nums">
                      Scene {numberOf(i)}
                      {p.id === current.id && ' · open now'}
                    </p>
                    <p className="truncate font-display text-base text-ink">{shownName}</p>
                    <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
                      {p.flow.stages.length} stages
                      {p.voice && ` · voice: ${p.voice.voices[p.voice.activeVoice]?.name.trim() || `Voice ${p.voice.activeVoice + 1}`}`}
                      {p.music && ` · ♫ ${p.music.name}`} · saved {timeAgo(p.updatedAt)}
                    </p>
                  </div>
                  {p.boardUrl ? (
                    <a href={p.boardUrl} target="_blank" rel="noopener noreferrer" className={buttonOutline}>
                      FigJam ↗
                    </a>
                  ) : (
                    <span className="font-label text-[10px] uppercase tracking-wide text-muted-ink">No board linked</span>
                  )}
                  <button onClick={() => onOpen(p)} disabled={p.id === current.id && !current.dirty} className={buttonPrimary}>
                    Open
                  </button>
                  <button
                    onClick={() => void exportProject(p).catch(() => setError('Export failed.'))}
                    className={buttonOutline}
                    title="Download this scene (music included) as a file — to back it up, hand it in, or open it on another computer"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => setToDelete(p)}
                    className="font-label text-[11px] uppercase tracking-widest text-[#b91c1c] hover:underline"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-4">
          <button onClick={startNew} className={buttonOutline}>
            New blank scene
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className={`ml-auto ${buttonOutline}`}
            title="Add a scene from a file made with Export"
          >
            Import scene file…
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="font-body text-[11px] leading-snug text-muted-ink">
          Scenes are saved in this browser, on this computer. Export a scene to keep a copy, hand it in, or move it to
          another computer.
        </p>
      </div>
      {toDelete && (
        <ConfirmDialog
          title={`Delete “${toDelete.name}”?`}
          message="Are you sure you want to delete this Scene? This action cannot be undone."
          confirmLabel="Delete Scene"
          onConfirm={() => void remove(toDelete)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
