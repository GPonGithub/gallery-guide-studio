import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * ffmpeg on the computer running the app (for thumbnails of video the browser
 * can't show — see /api/media/thumbnail). The app's own copy first: the
 * ffmpeg-static package, which `npm install` fetches for each computer, so
 * nobody installs ffmpeg separately. Then one installed on the computer.
 */
export const FFMPEG_PLACES = [
  process.env.FFMPEG_PATH,
  path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  'ffmpeg',
].filter((p): p is string => Boolean(p));

/** Runs ffmpeg (the first of FFMPEG_PLACES there is); resolves with what it wrote out. */
export function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tryAt = (i: number) => {
      if (i >= FFMPEG_PLACES.length) return reject(new Error('ffmpeg isn’t installed on this computer.'));
      const run = spawn(FFMPEG_PLACES[i], args);
      const out: Buffer[] = [];
      let err = '';
      run.stdout.on('data', (d: Buffer) => out.push(d));
      run.stderr.on('data', (d: Buffer) => (err += d.toString()));
      run.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? tryAt(i + 1) : reject(e)));
      run.on('close', (code) =>
        code === 0 && out.length > 0
          ? resolve(Buffer.concat(out))
          : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg failed.')),
      );
    };
    tryAt(0);
  });
}

/** Which ffmpeg the app would use: its own copy, one on the computer, or none. */
export async function ffmpegSource(): Promise<'app' | 'computer' | null> {
  for (const [i, place] of FFMPEG_PLACES.entries()) {
    const works = await new Promise<boolean>((resolve) => {
      const run = spawn(place, ['-version']);
      run.on('error', () => resolve(false));
      run.on('close', (code) => resolve(code === 0));
    });
    if (works) return place.includes(`${path.sep}ffmpeg-static${path.sep}`) && i <= 1 ? 'app' : 'computer';
  }
  return null;
}
