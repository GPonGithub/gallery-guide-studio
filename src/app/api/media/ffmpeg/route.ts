import { spawn } from 'node:child_process';
import { ffmpegSource } from '@/lib/ffmpeg';
import { isHosted } from '@/lib/serverKeys';

export const maxDuration = 300;

// Whether video thumbnails can be made (ffmpeg — see lib/ffmpeg.ts), and the
// Media Library's "Run npm install" button: fetches the app's packages,
// ffmpeg among them, on this computer — for a copy that was updated without
// it. Only when the app runs on this computer, only from the app's own page,
// and it runs nothing but `npm install` in the app's folder.

export async function GET() {
  if (isHosted) return Response.json({ hosted: true, ffmpeg: null });
  return Response.json({ hosted: false, ffmpeg: await ffmpegSource() });
}

let running = false;

export async function POST(req: Request) {
  if (isHosted) return Response.json({ ok: false, error: 'Only when the app runs on this computer.' }, { status: 501 });
  // Only from the app's own page (another website can't make this computer install things).
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  }
  if (running) return Response.json({ ok: false, error: 'npm install is already running.' }, { status: 409 });
  running = true;
  try {
    const { code, output } = await new Promise<{ code: number | null; output: string }>((resolve) => {
      const run = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
        cwd: process.cwd(),
        shell: process.platform === 'win32',
        // Plain text: no terminal colours in what's shown.
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_color: 'false' },
      });
      let output = '';
      run.stdout.on('data', (d: Buffer) => (output += d.toString()));
      run.stderr.on('data', (d: Buffer) => (output += d.toString()));
      run.on('error', (e) => resolve({ code: 1, output: `${output}\n${e.message}` }));
      run.on('close', (code) => resolve({ code, output }));
    });
    const last = output.replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n').slice(-6).join('\n');
    console.log(`[npm install] ${code === 0 ? 'done' : `FAILED (${code})`}`);
    return Response.json({ ok: code === 0, output: last, ffmpeg: await ffmpegSource() });
  } finally {
    running = false;
  }
}
