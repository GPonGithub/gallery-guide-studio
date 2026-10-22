import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SavedVoice } from '@/components/agent/VoicePanel';
import type { VoiceSettings } from '@/lib/types';
import type { AgentFlow } from './types';
import type { MediaLink } from './mediaFolder';

/**
 * Saved Chatbot Designer projects — a flow plus the brief it came from, the
 * FigJam board it lives on, its voices and its background music. Kept next
 * to the app (not in the browser) so projects survive cleared browser data
 * and show up in any browser on this computer. API keys are never part of a
 * project.
 */
export type ProjectVoice = {
  voices: SavedVoice[];
  activeVoice: number;
  voiceSettings: VoiceSettings | null;
  /** The voice in use speaks with ElevenLabs' expressive model (missing = regular). */
  expressive?: boolean;
};

/**
 * Where an imported scene came from: its sheet and column (its lasting link
 * to the sheet — the scene's own id is separate), its number as the sheet
 * gives it, and its name and description as last imported (to tell whether
 * they've been edited in the app since).
 */
export type SheetSource = {
  sheetId: string;
  gid: string;
  column: string;
  number: string;
  importedName: string;
  importedBrief: string;
  /** Rows 4–7 as last imported (each missing on scenes imported before it was read separately). */
  importedKnowledge?: string;
  importedSaveInfo?: string;
  importedSceneUse?: string;
  importedCannotUse?: string;
  /** The knowledge base under its earlier name (scenes imported when row 4 was called "can use"). */
  importedCanUse?: string;
};

/** The music's file is stored separately (see musicFile); `key` changes whenever a new file is dropped in. */
export type ProjectMusic = { name: string; key: string; volume: number; dip: number };

export type AgentProject = {
  id: string;
  name: string;
  flow: AgentFlow;
  brief: string;
  /** The description as it was when the flow was last generated from it (null = never). */
  generatedBrief?: string | null;
  boardUrl: string;
  /** Missing on projects saved before voices were part of a project. */
  voice?: ProjectVoice;
  /** null/missing = no background music. */
  music?: ProjectMusic | null;
  /** The scene's media timeline as last saved (missing on scenes saved before the timeline was). */
  timeline?: MediaLink[];
  /** Position in the Scenes list (0 = first), set by dragging; missing = not placed yet. */
  order?: number;
  /** Set for scenes imported from a Google Sheet. */
  sheet?: SheetSource;
  /** Fingerprint of the flow as last written to FigJam (null/missing = never written). */
  figjamFlow?: string | null;
  /** Put away: listed separately, and never changed by a Google Sheet import. */
  archived?: boolean;
  updatedAt: number;
};

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'agent-projects.json');
const MUSIC_DIR = path.join(DATA_DIR, 'agent-music');

/** Where a project's music file lives (ids are UUIDs we made, but never trust a path). */
export function musicFile(id: string): string | null {
  return /^[A-Za-z0-9-]{1,64}$/.test(id) ? path.join(MUSIC_DIR, id) : null;
}

export function writeMusic(id: string, bytes: Uint8Array): boolean {
  const file = musicFile(id);
  if (!file) return false;
  mkdirSync(MUSIC_DIR, { recursive: true });
  writeFileSync(file, bytes);
  return true;
}

export function readMusic(id: string): Buffer | null {
  const file = musicFile(id);
  return file && existsSync(file) ? readFileSync(file) : null;
}

export function copyMusic(fromId: string, toId: string): boolean {
  const from = musicFile(fromId);
  const to = musicFile(toId);
  if (!from || !to || !existsSync(from)) return false;
  mkdirSync(MUSIC_DIR, { recursive: true });
  copyFileSync(from, to);
  return true;
}

function deleteMusic(id: string) {
  const file = musicFile(id);
  if (file) rmSync(file, { force: true });
}

export function getProject(id: string): AgentProject | null {
  return readAll().find((p) => p.id === id) ?? null;
}

function readAll(): AgentProject[] {
  try {
    return JSON.parse(readFileSync(STORE_FILE, 'utf8')) as AgentProject[];
  } catch {
    return [];
  }
}

function writeAll(projects: AgentProject[]) {
  mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a half-written file.
  const temp = `${STORE_FILE}.tmp`;
  writeFileSync(temp, JSON.stringify(projects, null, 2));
  renameSync(temp, STORE_FILE);
}

export function listProjects(): AgentProject[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProject(input: Omit<AgentProject, 'id' | 'updatedAt'> & { id?: string }): AgentProject {
  const projects = readAll();
  const project: AgentProject = { ...input, id: input.id || randomUUID(), updatedAt: Date.now() };
  const index = projects.findIndex((p) => p.id === project.id);
  if (index >= 0) projects[index] = project;
  else projects.push(project);
  writeAll(projects);
  if (!project.music) deleteMusic(project.id);
  return project;
}

export function deleteProject(id: string): boolean {
  const projects = readAll();
  const remaining = projects.filter((p) => p.id !== id);
  if (remaining.length === projects.length) return false;
  writeAll(remaining);
  deleteMusic(id);
  return true;
}
