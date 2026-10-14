import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentFlow } from './types';

/**
 * Saved Goal Agent Studio projects — a flow plus the brief it came from and
 * the FigJam board it lives on. Kept in a JSON file next to the app (not in
 * the browser) so projects survive cleared browser data and show up in any
 * browser on this computer. API keys are never part of a project.
 */
export type AgentProject = {
  id: string;
  name: string;
  flow: AgentFlow;
  brief: string;
  boardUrl: string;
  updatedAt: number;
};

const STORE_FILE = path.join(process.cwd(), '.data', 'agent-projects.json');

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
  return project;
}

export function deleteProject(id: string): boolean {
  const projects = readAll();
  const remaining = projects.filter((p) => p.id !== id);
  if (remaining.length === projects.length) return false;
  writeAll(remaining);
  return true;
}
