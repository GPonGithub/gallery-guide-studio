import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { findFfmpeg } from '@/lib/ffmpeg';
import { isHosted } from '@/lib/serverKeys';

export const maxDuration = 800;

// Converts a video TouchDesigner (and the browser) would struggle with — HEVC, ProRes, PNG and other
// heavy codecs — with ffmpeg on this computer: to H.264 (at most 1920×1080, 4:2:0, AAC sound), or, for
// a video with transparency, to HAP Alpha (which keeps it, and which TouchDesigner decodes on the
// graphics card). The file is sent in (POST); the reply is a stream of lines, one JSON object each —
// {progress} (0–1) as it goes, then {done, id} — and GET ?id= then sends the converted file, once.
// Only when the app runs on this computer, and only from the app's own page.

const LARGEST = 20 * 1024 ** 3; // 20 GB
type Target = 'h264' | 'hap-alpha';
const finished = new Map<string, { dir: string; file: string }>();

// Each video fits in 1920×1080 (never enlarged), with even sides (H.264 needs them).
const FIT = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";

function argsFor(target: Target, input: string, output: string, encoder: 'videotoolbox' | 'x264'): string[] {
  const video =
    target === 'hap-alpha'
      ? ['-c:v', 'hap', '-format', 'hap_alpha', '-vf', FIT]
      : encoder === 'videotoolbox'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', '12M', '-profile:v', 'high', '-vf', `${FIT},format=yuv420p`]
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-vf', `${FIT},format=yuv420p`];
  return [
    '-y',
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    ...video,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    output,
  ];
}

/** Runs one conversion, telling `onProgress` how far it is (0–1). Rejects with ffmpeg's last words. */
function convert(ffmpeg: string, args: string[], onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const run = spawn(ffmpeg, args);
    let duration = 0;
    let err = '';
    run.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
      const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      if (m && !duration) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    });
    run.stdout.on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString().split('\n').reverse().join('\n'));
      if (m && duration > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
    });
    run.on('error', reject);
    run.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg failed.')),
    );
  });
}

const sameSite = (req: Request) => {
  const origin = req.headers.get('origin');
  return Boolean(origin && new URL(origin).host === req.headers.get('host'));
};

export async function POST(req: Request) {
  if (isHosted)
    return Response.json({ error: 'Videos are converted only when the app runs on this computer.' }, { status: 501 });
  if (!sameSite(req)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (!req.body) return Response.json({ error: 'No file was sent.' }, { status: 400 });
  if (Number(req.headers.get('content-length') ?? 0) > LARGEST)
    return Response.json({ error: 'That file is too big to convert here.' }, { status: 413 });
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return Response.json({ error: 'ffmpeg isn’t installed on this computer.' }, { status: 501 });
  const target: Target = req.headers.get('x-target') === 'hap-alpha' ? 'hap-alpha' : 'h264';
  const name = decodeURIComponent(req.headers.get('x-file-name') ?? 'video.mov');
  // HAP lives in QuickTime files; H.264 keeps the file's own kind (.mp4, .mov, .m4v).
  const ext = target === 'hap-alpha' ? 'mov' : (/\.(mp4|mov|m4v)$/i.exec(name)?.[1] ?? 'mp4').toLowerCase();
  const inExt = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'mov').toLowerCase();
  const dir = await mkdtemp(path.join(tmpdir(), 'chatbot-designer-convert-'));
  const input = path.join(dir, `in.${inExt}`);
  const output = path.join(dir, `out.${ext}`);
  // Kept as a file (not piped in): a QuickTime file's index can sit at its end, so ffmpeg needs to seek.
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as WebReadableStream), createWriteStream(input));
  } catch {
    await rm(dir, { recursive: true, force: true });
    return Response.json({ error: 'The file didn’t arrive.' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const say = (o: object) => controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      let last = -1;
      const onProgress = (p: number) => {
        const r = Math.round(p * 100);
        if (r !== last) {
          last = r;
          say({ progress: p });
        }
      };
      say({ progress: 0 });
      try {
        try {
          await convert(
            ffmpeg,
            argsFor(target, input, output, process.platform === 'darwin' ? 'videotoolbox' : 'x264'),
            onProgress,
          );
        } catch (err) {
          // The Mac's own H.264 encoder can refuse some sizes: the software one then does it.
          if (target !== 'h264' || process.platform !== 'darwin') throw err;
          await convert(ffmpeg, argsFor(target, input, output, 'x264'), onProgress);
        }
        await rm(input, { force: true });
        const id = path.basename(dir);
        finished.set(id, { dir, file: output });
        // Not collected within the hour: it goes.
        setTimeout(() => {
          if (finished.delete(id)) void rm(dir, { recursive: true, force: true });
        }, 3600_000);
        say({ done: true, id, ext, size: (await stat(output)).size });
      } catch (err) {
        await rm(dir, { recursive: true, force: true });
        say({ error: err instanceof Error ? err.message : 'The video couldn’t be converted.' });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  if (isHosted) return Response.json({ hosted: true, available: false });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ hosted: false, available: Boolean(await findFfmpeg()) });
  const job = finished.get(id);
  if (!job) return Response.json({ error: 'That converted video has gone — convert it again.' }, { status: 404 });
  finished.delete(id);
  const size = (await stat(job.file)).size;
  const body = Readable.toWeb(createReadStream(job.file)) as unknown as ReadableStream<Uint8Array>;
  // Sent: the temporary copy goes.
  const cleanup = new TransformStream<Uint8Array, Uint8Array>({
    flush: () => void rm(job.dir, { recursive: true, force: true }),
  });
  return new Response(body.pipeThrough(cleanup), {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), 'Cache-Control': 'no-store' },
  });
}
