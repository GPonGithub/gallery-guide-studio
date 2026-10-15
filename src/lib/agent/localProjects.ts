'use client';

import { run } from '@/lib/browserDb';
import type { AgentProject } from './projectStore';

/**
 * Saved projects, kept in this browser (see browserDb.ts) — each student's
 * work stays on their own computer, which is what lets one hosted copy of
 * the app serve a whole class. A project can be exported as a single file
 * (music included) to back it up, hand it in, or move it to another computer.
 */

export async function listProjects(): Promise<AgentProject[]> {
  const projects = await run<AgentProject[]>('projects', 'readonly', (store) => store.getAll());
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<AgentProject | null> {
  return (await run<AgentProject | undefined>('projects', 'readonly', (store) => store.get(id))) ?? null;
}

export async function putProject(project: AgentProject): Promise<void> {
  await run('projects', 'readwrite', (store) => store.put(project, project.id));
}

export async function deleteProject(id: string): Promise<void> {
  await run('projects', 'readwrite', (store) => store.delete(id));
  await run('projectMusic', 'readwrite', (store) => store.delete(id));
}

export async function getProjectMusic(id: string): Promise<Blob | null> {
  return (await run<Blob | undefined>('projectMusic', 'readonly', (store) => store.get(id))) ?? null;
}

async function putProjectMusic(id: string, blob: Blob): Promise<void> {
  await run('projectMusic', 'readwrite', (store) => store.put(blob, id));
}

/** What a save needs: the project's content, and its music file if it has music. */
export type ProjectToSave = Omit<AgentProject, 'id' | 'updatedAt'> & {
  /** Keep this id (an existing project), or null to save as a new one. */
  id: string | null;
  /** The music file, if this browser has it. */
  musicBlob: () => Promise<Blob | null>;
  /** Where to copy the music from when saving a copy of a project whose file only it has. */
  copyMusicFrom?: string | null;
};

export async function saveProject(input: ProjectToSave): Promise<AgentProject> {
  const { musicBlob, copyMusicFrom, ...content } = input;
  const project: AgentProject = { ...content, id: input.id ?? crypto.randomUUID(), updatedAt: Date.now() };
  if (project.music) {
    const blob = (await musicBlob()) ?? (copyMusicFrom ? await getProjectMusic(copyMusicFrom) : null);
    // Never quietly save a project whose music file didn't go with it.
    if (!blob) {
      throw new Error(`The music file “${project.music.name}” isn’t loaded here — drop it into the Music panel and save again.`);
    }
    await putProjectMusic(project.id, blob);
  } else {
    await run('projectMusic', 'readwrite', (store) => store.delete(project.id));
  }
  await putProject(project);
  return project;
}

// --- export / import ------------------------------------------------------

const FORMAT = 'goal-agent-project';

type ProjectFile = {
  format: typeof FORMAT;
  version: 1;
  project: AgentProject;
  /** The music file, base64-encoded, if the project has music. */
  music?: { type: string; base64: string };
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Downloads a project, music included, as one .json file. */
export async function exportProject(project: AgentProject): Promise<void> {
  const music = project.music ? await getProjectMusic(project.id) : null;
  const file: ProjectFile = {
    format: FORMAT,
    version: 1,
    project,
    ...(music && { music: { type: music.type || 'audio/mpeg', base64: await blobToBase64(music) } }),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^\w\s-]+/g, '').trim() || 'project'}.goal-agent.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Adds a project from an exported file. If a project with the same id is
 * already here it's replaced only when `replace` says so; otherwise the
 * import comes in as a copy.
 */
export async function importProject(file: File, replace: (existing: AgentProject) => boolean): Promise<AgentProject> {
  let data: ProjectFile;
  try {
    data = JSON.parse(await file.text()) as ProjectFile;
  } catch {
    throw new Error(`“${file.name}” isn’t a project file.`);
  }
  if (data?.format !== FORMAT || !data.project?.flow) throw new Error(`“${file.name}” isn’t a Goal Agent project file.`);
  const existing = await getProject(data.project.id);
  const project: AgentProject =
    existing && !replace(existing)
      ? { ...data.project, id: crypto.randomUUID(), name: `${data.project.name} (imported)`, updatedAt: Date.now() }
      : data.project;
  if (data.music && project.music) {
    const bytes = Uint8Array.from(atob(data.music.base64), (c) => c.charCodeAt(0));
    await putProjectMusic(project.id, new Blob([bytes], { type: data.music.type }));
  }
  await putProject(project);
  return project;
}

// --- one-time move from the old server-side store -----------------------

const MIGRATED_FLAG = 'goal-agent-projects-moved-to-browser';
let migration: Promise<void> | null = null;

/**
 * Projects used to be saved by the app server, in .data on the computer
 * running it. The first time this browser opens the studio, it copies any
 * found there (music included). A hosted copy has none, so this does nothing.
 */
export function moveServerProjectsHere(): Promise<void> {
  migration ??= (async () => {
    try {
      if (window.localStorage.getItem(MIGRATED_FLAG)) return;
    } catch {
      return; // no storage to remember it in — don't risk copying again and again
    }
    try {
      const res = await fetch('/api/agent/projects', { cache: 'no-store' });
      if (!res.ok) return;
      const { projects } = (await res.json()) as { projects?: AgentProject[] };
      for (const project of projects ?? []) {
        if (await getProject(project.id)) continue;
        if (project.music) {
          const music = await fetch(`/api/agent/projects/music?id=${encodeURIComponent(project.id)}`, { cache: 'no-store' });
          if (music.ok) await putProjectMusic(project.id, await music.blob());
        }
        await putProject(project);
      }
      window.localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
    } catch {
      // Try again next time the studio opens.
      migration = null;
    }
  })();
  return migration;
}
