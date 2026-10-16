import { mapSheetScenes, parseCsv, parseSheetUrl } from '@/lib/agent/sheetScenes';

export const maxDuration = 30;

// Reads the scenes from a Google Sheet shared as "Anyone with the link can
// view". Fetched here rather than in the browser (Google's export link
// doesn't allow that), and only ever from Google's own export address, built
// from the sheet's id — never from whatever URL was pasted.
export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  const sheet = parseSheetUrl(url ?? '');
  if (!sheet) {
    return Response.json({ error: 'That doesn’t look like a Google Sheets link (docs.google.com/spreadsheets/d/…).' }, { status: 400 });
  }
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/export?format=csv&gid=${sheet.gid}`;
  let res: Response;
  try {
    res = await fetch(exportUrl, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return Response.json({ error: 'Couldn’t reach Google Sheets — check the internet connection and try again.' }, { status: 502 });
  }
  const type = res.headers.get('content-type') ?? '';
  // A sheet that isn't shared answers with Google's sign-in page, not a CSV.
  if (!res.ok || !type.includes('text/csv')) {
    return Response.json(
      {
        error:
          res.status === 404
            ? 'Google couldn’t find that sheet (or that tab). Check the link.'
            : 'Google wouldn’t share that sheet. In the sheet, click Share → General access → “Anyone with the link” (Viewer), then try again.',
      },
      { status: 400 },
    );
  }
  const scenes = mapSheetScenes(parseCsv(await res.text()));
  return Response.json({ sheetId: sheet.sheetId, gid: sheet.gid, scenes });
}
