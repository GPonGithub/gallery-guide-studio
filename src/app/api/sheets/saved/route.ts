import { isScriptUrl } from '@/lib/agent/sheetScript';

export const maxDuration = 30;

type SaveRequest = {
  scriptUrl?: string;
  /** 'clear' empties row 7 in `column` — one column letter, or '*' for every scene column. */
  action?: 'save' | 'clear';
  /** Leave out the rest to just test the link. */
  spreadsheetId?: string;
  gid?: string;
  column?: string;
  patient?: string;
  entries?: { label: string; value: string }[];
};

// Passes what a scene saved to the sheet's own Apps Script (see
// lib/agent/sheetScript.ts), which writes it into row 7. Only ever to an
// Apps Script web app address — never anywhere else that was pasted.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SaveRequest;
  const scriptUrl = body.scriptUrl?.trim() ?? '';
  if (!isScriptUrl(scriptUrl)) {
    return Response.json(
      { ok: false, error: 'That isn’t an Apps Script web app link (https://script.google.com/macros/s/…/exec).' },
      { status: 400 },
    );
  }
  const testing = !body.column;
  if (body.action === 'clear' && !/^([B-Z]|\*)$/.test(body.column ?? '')) {
    return Response.json({ ok: false, error: 'Not a scene column.' }, { status: 400 });
  }
  let res: Response;
  try {
    res = testing
      ? await fetch(scriptUrl, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      : await fetch(scriptUrl, {
          method: 'POST',
          // Plain text: Apps Script reads the body the same way, and Google's redirect keeps working.
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: body.action === 'clear' ? 'clear' : 'save',
            spreadsheetId: body.spreadsheetId,
            gid: body.gid,
            // A clear names its column separately: a script from before clearing existed sees
            // no valid column, and refuses without writing anything.
            ...(body.action === 'clear' ? { column: 'clear', clearColumn: body.column } : { column: body.column }),
            patient: body.patient,
            entries: (body.entries ?? []).slice(0, 100),
          }),
          redirect: 'follow',
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        });
  } catch {
    return Response.json({ ok: false, error: 'Couldn’t reach the sheet’s script — check the internet connection.' }, { status: 502 });
  }
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { ok: boolean; error?: string; spreadsheetId?: string; name?: string; text?: string; cleared?: string[] };
    // A script from before clearing existed answers a clear as if it were a save: say so instead.
    if (body.action === 'clear' && !Array.isArray(data.cleared) && (data.ok || /Not a scene column/.test(data.error ?? ''))) {
      return Response.json({
        ok: false,
        error: 'The sheet’s Apps Script needs updating to clear row 7: copy the script again (section 1), paste it over the old one, then Deploy → Manage deployments → edit → New version.',
      });
    }
    if (testing && data.ok && body.spreadsheetId && data.spreadsheetId !== body.spreadsheetId) {
      return Response.json({ ok: false, error: `That script belongs to “${data.name}”, not the sheet these scenes came from.` });
    }
    return Response.json(data);
  } catch {
    // Google answers with a sign-in or error page when the deployment isn't open to "Anyone".
    return Response.json({
      ok: false,
      error: 'The script didn’t answer. In Apps Script, check the deployment: Execute as “Me”, Who has access “Anyone”.',
    });
  }
}
