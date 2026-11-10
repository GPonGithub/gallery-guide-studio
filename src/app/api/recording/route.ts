import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { runFfmpeg } from '@/lib/ffmpeg';
import { isHosted } from '@/lib/serverKeys';

export const maxDuration = 300;

// Record conversation (lib/agent/conversationRecorder.ts): the browser sends a conversation's recording
// as it made it (WebM / Opus); ffmpeg on this computer turns it into an MP3. With a folder (x-folder, a
// path on this computer that was pasted into the dialog) the MP3 is written there and its path comes
// back; without one the MP3 itself comes back, for the browser to save. x-action: check only says
// whether the folder is there. Only when the app runs on this computer, only from the app's own page,
// and it writes nothing but that one sound file, into a folder that already exists.

const LARGEST = 2 * 1024 ** 3; // 2 GB

/** A folder as someone pastes it: quoted, dragged from Terminal (escaped spaces), a file:// address, or ~/… */
function cleanFolder(raw: string): string {
  let p = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      // Left as it is.
    }
  }
  p = p.replace(/\\(.)/g, '$1');
  if (p === '~' || p.startsWith('~/')) p = path.join(homedir(), p.slice(1));
  return p ? path.normalize(p) : '';
}

async function folderProblem(folder: string): Promise<string | null> {
  if (!folder) return 'No folder was given.';
  if (!path.isAbsolute(folder)) return 'Give the folder’s whole path, starting with / (in Finder: right-click the folder, hold Option, Copy as Pathname).';
  try {
    if (!(await stat(folder)).isDirectory()) return 'That’s a file, not a folder.';
  } catch {
    return 'There’s no folder at that path on this computer.';
  }
  return null;
}

const header = (req: Request, name: string) => {
  try {
    return decodeURIComponent(req.headers.get(name) ?? '');
  } catch {
    return '';
  }
};

/** A file name in the folder that isn't taken: "name.mp3", then "name (2).mp3"… */
async function freeName(folder: string, base: string, ext: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const file = path.join(folder, `${base}${n === 1 ? '' : ` (${n})`}.${ext}`);
    try {
      await access(file);
    } catch {
      return file;
    }
  }
  return path.join(folder, `${base} ${Date.now()}.${ext}`);
}

export async function POST(req: Request) {
  if (isHosted) return Response.json({ ok: false, error: 'Recordings are saved only when the app runs on this computer.' }, { status: 501 });
  // Only from the app's own page (another website can't make this computer write files).
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  const folder = cleanFolder(header(req, 'x-folder'));
  if (req.headers.get('x-action') === 'check') {
    const problem = await folderProblem(folder);
    return Response.json(problem ? { ok: false, error: problem } : { ok: true, folder });
  }
  if (folder) {
    const problem = await folderProblem(folder);
    if (problem) return Response.json({ ok: false, error: problem }, { status: 400 });
  }
  if (!req.body) return Response.json({ ok: false, error: 'No recording was sent.' }, { status: 400 });
  if (Number(req.headers.get('content-length') ?? 0) > LARGEST) {
    return Response.json({ ok: false, error: 'That recording is too big.' }, { status: 413 });
  }
  const base =
    header(req, 'x-file-name')
      .replace(/[^\w .()-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Conversation';
  const rawExt = (req.headers.get('content-type') ?? '').includes('mp4') ? 'm4a' : 'webm';
  const dir = await mkdtemp(path.join(tmpdir(), 'chatbot-designer-recording-'));
  const input = path.join(dir, `in.${rawExt}`);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as WebReadableStream), createWriteStream(input));
    let sound: Buffer;
    let ext = 'mp3';
    let converted = true;
    try {
      sound = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-f', 'mp3', 'pipe:1']);
    } catch (err) {
      // No ffmpeg on this computer: the recording is kept as the browser made it.
      console.warn(`[recording] not converted: ${err instanceof Error ? err.message : err}`);
      sound = await readFile(input);
      ext = rawExt;
      converted = false;
    }
    if (!folder) {
      return new Response(new Uint8Array(sound), {
        headers: { 'Content-Type': converted ? 'audio/mpeg' : `audio/${rawExt === 'm4a' ? 'mp4' : 'webm'}`, 'x-converted': converted ? '1' : '0' },
      });
    }
    const file = await freeName(folder, base, ext);
    await writeFile(file, sound);
    console.log(`[recording] saved ${file} (${Math.round(sound.length / 1024)} KB)`);
    return Response.json({ ok: true, path: file, converted });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'The recording wasn’t saved.' }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
