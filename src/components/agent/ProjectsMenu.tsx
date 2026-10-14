'use client';

import { useEffect, useState } from 'react';
import type { AgentProject, ProjectMusic, ProjectVoice } from '@/lib/agent/projectStore';
import type { AgentFlow } from '@/lib/agent/types';
import { buttonOutline, buttonPrimary, buttonSaved, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';

// Save the current flow (with its brief, FigJam board, voices and background
// music) under a name, and reopen any saved project later — including
// jumping straight to its board.

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
  boardUrl: string;
  voice: ProjectVoice;
  music: ProjectMusic | null;
  /** The music file itself, if this browser has it. */
  musicBlob: () => Promise<Blob | null>;
};

export async function saveProjectRequest(current: CurrentProject, name: string, asNew: boolean): Promise<AgentProject> {
  const res = await fetch('/api/agent/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: asNew ? undefined : current.id ?? undefined,
      name,
      flow: current.flow,
      brief: current.brief,
      boardUrl: current.boardUrl,
      voice: current.voice,
      music: current.music,
    }),
  });
  const data = (await res.json()) as { project: AgentProject } | { error: string };
  if ('error' in data) throw new Error(data.error);
  const project = data.project;
  // The music file goes up alongside — or, for a copy of a project whose file
  // only the server has, is copied across there.
  if (current.music) {
    const blob = await current.musicBlob();
    const upload = blob
      ? fetch(`/api/agent/projects/music?id=${encodeURIComponent(project.id)}`, { method: 'PUT', body: blob })
      : asNew && current.id
        ? fetch(`/api/agent/projects/music?id=${encodeURIComponent(project.id)}&from=${encodeURIComponent(current.id)}`, {
            method: 'POST',
          })
        : null;
    if (!upload && !blob) {
      // Never quietly save a project whose music file didn't go with it.
      throw new Error(
        `The project was saved, but its music file “${current.music.name}” isn’t loaded here — drop it into the Music panel and save again.`,
      );
    }
    const stored = upload ? await upload : null;
    if (stored && !stored.ok) {
      throw new Error(`The project was saved, but its music wasn’t: ${((await stored.json()) as { error?: string }).error ?? 'unknown error'}`);
    }
  }
  return project;
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
  onNew: (kind: 'blank' | 'example') => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<AgentProject[] | null>(null);
  const [name, setName] = useState(current.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/agent/projects', { cache: 'no-store' });
      const data = (await res.json()) as { projects: AgentProject[] } | { error: string };
      if ('error' in data) throw new Error(data.error);
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load projects.');
      setProjects([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the saved-projects list from the server when the menu opens
    void refresh();
  }, []);

  const save = async (asNew: boolean) => {
    if (!name.trim()) {
      setError('Give the project a name first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const project = await saveProjectRequest(current, name.trim(), asNew);
      onSaved(project);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // "Not saved" (red) until this is on disk as it stands, name included; then "Saved" (green).
  const unsaved = !current.id || current.dirty || name.trim() !== current.name;

  const remove = async (project: AgentProject) => {
    if (!window.confirm(`Delete the project "${project.name}"? This can't be undone. (Its FigJam board is not affected.)`)) return;
    await fetch(`/api/agent/projects?id=${encodeURIComponent(project.id)}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/60 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className="flex max-h-[84vh] w-full max-w-2xl flex-col gap-4 border-2 border-ink bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Projects</h2>
          <button onClick={onClose} className="text-xl leading-none text-ink hover:text-muted-ink" aria-label="Close">
            ×
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <p className={fieldLabel}>
            {current.id ? 'This project' : 'Save what’s open now'}
            {current.dirty ? ' · unsaved changes' : current.id ? ' · saved' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save(false)}
              placeholder="Project name"
              className={`min-w-[220px] flex-1 ${fieldInput}`}
            />
            <button
              onClick={() => save(false)}
              disabled={saving}
              className={unsaved ? buttonUnsaved : buttonSaved}
              title={unsaved ? 'Save the project' : 'Everything is saved — click to save again'}
            >
              {saving ? 'Saving…' : unsaved ? 'Not saved' : 'Saved ✓'}
            </button>
            {current.id && (
              <button onClick={() => save(true)} disabled={saving} className={buttonOutline} title="Keep the original and save this as a separate project">
                Save as copy
              </button>
            )}
          </div>
          {error && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{error}</p>}
        </section>

        <section className="flex min-h-0 flex-col gap-2">
          <p className={fieldLabel}>Saved projects</p>
          <div className="min-h-0 overflow-y-auto border-t-2 border-ink">
            {projects === null && <p className="py-3 font-body text-sm italic text-muted-ink">Loading…</p>}
            {projects?.length === 0 && (
              <p className="py-3 font-body text-sm italic text-muted-ink">No saved projects yet.</p>
            )}
            {projects?.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-hair py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base text-ink">
                    {p.name}
                    {p.id === current.id && (
                      <span className="ml-2 font-label text-[10px] uppercase tracking-widest text-muted-ink">open now</span>
                    )}
                  </p>
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
                  onClick={() => remove(p)}
                  className="font-label text-[11px] uppercase tracking-widest text-[#b91c1c] hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-4">
          <button onClick={() => onNew('blank')} className={buttonOutline}>
            New blank project
          </button>
          <button onClick={() => onNew('example')} className={buttonOutline}>
            New from UCSF example
          </button>
        </div>
      </div>
    </div>
  );
}
