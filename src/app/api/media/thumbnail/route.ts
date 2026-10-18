import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { runFfmpeg } from '@/lib/ffmpeg';
import { isHosted } from '@/lib/serverKeys';

export const maxDuration = 60;

// A thumbnail for a video the browser can't show itself (e.g. ProRes 4444
// with an alpha channel, which TouchDesigner plays but Chrome can't): its
// first frame, made with ffmpeg on this computer, as a PNG (transparency
// kept). Only when the app runs on this computer — a hosted copy has no
// ffmpeg, and the media folder isn't there.

const LARGEST = 4 * 1024 ** 3; // 4 GB

export async function POST(req: Request) {
  if (isHosted)
    return Response.json(
      { error: 'Thumbnails by ffmpeg only work when the app runs on this computer.' },
      { status: 501 },
    );
  if (!req.body) return Response.json({ error: 'No file was sent.' }, { status: 400 });
  if (Number(req.headers.get('content-length') ?? 0) > LARGEST) {
    return Response.json({ error: 'That file is too big to make a thumbnail from.' }, { status: 413 });
  }
  // Kept as a file (not piped in): a QuickTime file's index can sit at its end, so ffmpeg needs to seek.
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(req.headers.get('x-file-name') ?? '')?.[1] ?? 'mov').toLowerCase();
  const dir = await mkdtemp(path.join(tmpdir(), 'chatbot-designer-thumb-'));
  const input = path.join(dir, `in.${ext}`);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as WebReadableStream), createWriteStream(input));
    const png = await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=352:-2',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      'pipe:1',
    ]);
    return new Response(new Blob([png as BlobPart]), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'The thumbnail couldn’t be made.' },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
