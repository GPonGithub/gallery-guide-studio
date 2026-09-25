/**
 * In-memory queue bridging the app to the FigJam plugin's UI, which polls
 * for work while its panel is open in Figma. Two job kinds share the same
 * queue: 'generate' (Generate Steps in FigJam — no payload, just "run
 * grow & populate now") and 'apply-edits' (Update FigJam file — payload
 * carries the specific edited step data to write). Lives only in this
 * Next.js dev-server process's memory — a server restart mid-job drops it.
 * That's an accepted tradeoff for a local prototyping tool talking to a
 * plugin on the same machine, not a durability guarantee.
 *
 * Not scoped per-board: jobs used to be tagged and claimed by Figma file
 * key, but `figma.fileKey` is only ever populated for privately-published
 * org plugins (per Figma's own Plugin API docs) — this dev-mode plugin
 * never has it, so that matching silently never worked and the plugin's
 * poll loop always no-op'd. Since the whole feature already assumes one
 * student's app and one plugin session on the same machine at a time (the
 * plugin can only reach `localhost:3000`, nothing hosted), there's nothing
 * a second dimension of scoping would actually disambiguate — a single
 * shared queue is both simpler and the thing that can actually work.
 */

export type FigmaJobStatus = 'pending' | 'running' | 'done' | 'error';
export type FigmaJobKind = 'generate' | 'apply-edits';

export type FigmaJob = {
  id: string;
  kind: FigmaJobKind;
  payload?: unknown;
  status: FigmaJobStatus;
  log: string[];
  createdAt: number;
};

const JOB_MAX_AGE_MS = 30 * 60 * 1000;

const jobs = new Map<string, FigmaJob>();

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_MAX_AGE_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createJob(kind: FigmaJobKind = 'generate', payload?: unknown): FigmaJob {
  pruneOldJobs();
  const job: FigmaJob = { id: crypto.randomUUID(), kind, payload, status: 'pending', log: [], createdAt: Date.now() };
  jobs.set(job.id, job);
  return job;
}

// Oldest pending job overall, flipped to 'running' as part of the same call
// so two concurrent polls can never both claim it.
export function claimNextJob(): FigmaJob | null {
  pruneOldJobs();
  const candidates = [...jobs.values()]
    .filter((j) => j.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  const job = candidates[0];
  if (!job) return null;
  job.status = 'running';
  return job;
}

export function updateJob(id: string, patch: { status?: FigmaJobStatus; message?: string }): FigmaJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (patch.status) job.status = patch.status;
  if (patch.message) job.log.push(patch.message);
  return job;
}

export function getJob(id: string): FigmaJob | null {
  return jobs.get(id) ?? null;
}
