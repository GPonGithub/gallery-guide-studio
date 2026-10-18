import { isScriptUrl } from '@/lib/agent/sheetScript';
import type { MediaRow } from '@/lib/agent/media';

export const maxDuration = 30;

type MediaRequest = {
  scriptUrl?: string;
  spreadsheetId?: string;
  action?: 'read' | 'write';
  rows?: MediaRow[];
};

// Reads or replaces the media list on the sheet's "Media" tab, through the
// sheet's own Apps Script (see lib/agent/sheetScript.ts). Only ever to an
// Apps Script web app address.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as MediaRequest;
  const scriptUrl = body.scriptUrl?.trim() ?? '';
  if (!isScriptUrl(scriptUrl)) {
    return Response.json({ ok: false, error: 'Connect the sheet’s Apps Script first (section 1).' }, { status: 400 });
  }
  const writing = body.action === 'write';
  const rows = (body.rows ?? []).slice(0, 5000).map((r) => ({
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    kind: String(r.kind ?? ''),
    path: String(r.path ?? ''),
    status: String(r.status ?? ''),
    added: String(r.added ?? ''),
  }));
  let res: Response;
  try {
    res = await fetch(scriptUrl, {
      method: 'POST',
      // Plain text: Apps Script reads the body the same way, and Google's redirect keeps working.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: writing ? 'writeMedia' : 'readMedia', spreadsheetId: body.spreadsheetId, ...(writing && { rows }) }),
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return Response.json({ ok: false, error: 'Couldn’t reach the sheet’s script — check the internet connection.' }, { status: 502 });
  }
  const text = await res.text();
  let data: { ok: boolean; error?: string; media?: MediaRow[]; written?: number };
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({
      ok: false,
      error: 'The script didn’t answer. In Apps Script, check the deployment: Execute as “Me”, Who has access “Anyone”.',
    });
  }
  // A script from before the media list existed treats these as a row-7 save: it either
  // refuses (no scenes tab named) or answers without the list.
  const answered = writing ? typeof data.written === 'number' : Array.isArray(data.media);
  const outdated = data.ok ? !answered : /tab wasn’t found|A7|scene column/i.test(data.error ?? '');
  if (outdated) {
    return Response.json({
      ok: false,
      outdated: true,
      error: 'The sheet’s Apps Script needs updating for the media list: copy the script again (section 1), paste it over the old one, then Deploy → Manage deployments → edit → New version.',
    });
  }
  console.log(`[sheet] media ${writing ? `write (${rows.length} files)` : 'read'} → ${data.ok ? 'done' : `FAILED: ${data.error}`}`);
  return Response.json(data);
}
