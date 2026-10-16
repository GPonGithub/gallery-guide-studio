/**
 * The queue between the app and the FigJam plugin's panel, which polls for
 * work while it's open in Figma. Job kinds: 'generate' (grow & populate),
 * 'apply-edits' (write edited steps), and the v4 studio's 'draw-agent-flow'
 * / 'read-agent-flow' (draw a flow's cards, or read them back).
 *
 * Two homes:
 * - Running on your own computer: in this server's memory, one shared
 *   queue — the app and the plugin are on the same machine, so there's
 *   only ever one of each. A restart mid-job drops it; that's fine.
 * - A hosted copy (Vercel): a shared Redis store (Upstash, via the Vercel
 *   Marketplace — UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN),
 *   because two requests can land on different servers. There, every
 *   student's jobs are kept apart by a connection code: the app shows its
 *   code, the student types it into the plugin once, and the plugin only
 *   takes jobs with its code. (Jobs can't be matched by board: `figma.fileKey`
 *   is never available to development plugins.)
 *
 * Jobs are kept for 30 minutes.
 */

import { isHosted } from './serverKeys';

export type FigmaJobStatus = 'pending' | 'running' | 'done' | 'error';
export type FigmaJobKind = 'generate' | 'apply-edits' | 'draw-agent-flow' | 'read-agent-flow';

export type FigmaJob = {
  id: string;
  kind: FigmaJobKind;
  payload?: unknown;
  /** What the plugin sends back, for jobs that read from the board. */
  result?: unknown;
  status: FigmaJobStatus;
  log: string[];
  createdAt: number;
};

const JOB_TTL_SECONDS = 30 * 60;
/** The plugin polls every ~4s while open; a minute without one means it's closed. */
const SEEN_TTL_SECONDS = 60;

/** A connection code as typed (any case, with or without the dash) → its stored form; '' if it isn't one. */
export function cleanCode(code: unknown): string {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length >= 6 && clean.length <= 16 ? clean : '';
}

/**
 * Whose queue a request belongs to: on your own computer, the one shared
 * queue; on a hosted copy, the connection code's (null without a valid one).
 */
export function queueFor(code: unknown): string | null {
  if (!isHosted) return 'local';
  return cleanCode(code) || null;
}

// --- Redis (hosted) ----------------------------------------------------------

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

/** Whether a hosted copy has its shared store connected. */
export function figjamStoreReady(): boolean {
  return Boolean(redisUrl && redisToken);
}

async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  const res = await fetch(redisUrl!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `The job store answered ${res.status}.`);
  return data.result as T;
}

const jobKey = (id: string) => `figjam:job:${id}`;
const queueKey = (queue: string) => `figjam:queue:${queue}`;
const seenKey = (queue: string) => `figjam:seen:${queue}`;

const redisStore = {
  async create(queue: string, job: FigmaJob) {
    await redis('SET', jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
    await redis('LPUSH', queueKey(queue), job.id);
    await redis('EXPIRE', queueKey(queue), JOB_TTL_SECONDS);
  },
  async get(id: string): Promise<FigmaJob | null> {
    const raw = await redis<string | null>('GET', jobKey(id));
    return raw ? (JSON.parse(raw) as FigmaJob) : null;
  },
  async put(job: FigmaJob) {
    await redis('SET', jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
  },
  /** Oldest pending job — RPOP takes it off the queue in one step, so two polls can never both get it. */
  async claim(queue: string): Promise<FigmaJob | null> {
    await redis('SET', seenKey(queue), Date.now(), 'EX', SEEN_TTL_SECONDS);
    for (;;) {
      const id = await redis<string | null>('RPOP', queueKey(queue));
      if (!id) return null;
      const job = await redisStore.get(id);
      if (job?.status === 'pending') return job; // (an expired or retired one is skipped)
    }
  },
  async lastSeen(queue: string): Promise<number | null> {
    const raw = await redis<string | null>('GET', seenKey(queue));
    return raw ? Number(raw) : null;
  },
};

// --- Memory (your own computer) ---------------------------------------------

const jobs = new Map<string, FigmaJob & { queue: string }>();
const seen = new Map<string, number>();

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_SECONDS * 1000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
}

const memoryStore = {
  async create(queue: string, job: FigmaJob) {
    pruneOldJobs();
    jobs.set(job.id, { ...job, queue });
  },
  async get(id: string): Promise<FigmaJob | null> {
    const job = jobs.get(id);
    if (!job) return null;
    const rest: FigmaJob & { queue?: string } = { ...job };
    delete rest.queue;
    return rest;
  },
  async put(job: FigmaJob) {
    const held = jobs.get(job.id);
    if (held) jobs.set(job.id, { ...job, queue: held.queue });
  },
  async claim(queue: string): Promise<FigmaJob | null> {
    seen.set(queue, Date.now());
    pruneOldJobs();
    const job = [...jobs.values()].filter((j) => j.queue === queue && j.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!job) return null;
    job.status = 'running';
    return memoryStore.get(job.id);
  },
  async lastSeen(queue: string): Promise<number | null> {
    const at = seen.get(queue);
    return at !== undefined && Date.now() - at < SEEN_TTL_SECONDS * 1000 ? at : null;
  },
};

const store = () => (isHosted ? redisStore : memoryStore);

// --- What the routes use -----------------------------------------------------

export async function createJob(queue: string, kind: FigmaJobKind = 'generate', payload?: unknown): Promise<FigmaJob> {
  const job: FigmaJob = { id: crypto.randomUUID(), kind, payload, status: 'pending', log: [], createdAt: Date.now() };
  await store().create(queue, job);
  return job;
}

/** The oldest pending job in a queue, already marked running. Also records that the plugin is there. */
export async function claimNextJob(queue: string): Promise<FigmaJob | null> {
  const job = await store().claim(queue);
  if (!job) return null;
  const running = { ...job, status: 'running' as const };
  await store().put(running);
  return running;
}

export async function updateJob(
  id: string,
  patch: { status?: FigmaJobStatus; message?: string; result?: unknown },
): Promise<FigmaJob | null> {
  const job = await store().get(id);
  if (!job) return null;
  const next: FigmaJob = {
    ...job,
    ...(patch.status && { status: patch.status }),
    ...(patch.result !== undefined && { result: patch.result }),
    log: patch.message ? [...job.log, patch.message] : job.log,
  };
  await store().put(next);
  return next;
}

export async function getJob(id: string): Promise<FigmaJob | null> {
  return store().get(id);
}

/** When the plugin with this queue last asked for work (null = not lately). */
export async function pluginLastSeen(queue: string): Promise<number | null> {
  return store().lastSeen(queue);
}
