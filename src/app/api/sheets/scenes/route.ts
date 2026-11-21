import { mapSheetScenes, parseCsv, parseSheetUrl } from '@/lib/agent/sheetScenes';
import { fetchSheetCsv, findScenesTab } from '@/lib/agent/sheetTab';

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
  let res: Response;
  try {
    res = await fetchSheetCsv(sheet.sheetId, sheet.gid);
  } catch {
    return Response.json({ error: 'Couldn’t reach Google Sheets — check the internet connection and try again.' }, { status: 502 });
  }
  const type = res.headers.get('content-type') ?? '';
  // Google answers 400 for a tab (gid) the sheet no longer has. When the scenes moved to another tab, that
  // tab is used instead — `movedFrom` tells the app to remember it for every scene of this sheet.
  if (res.status === 400) {
    const found = await findScenesTab(sheet.sheetId, sheet.gid);
    if (found) return Response.json({ sheetId: sheet.sheetId, gid: found.gid, movedFrom: sheet.gid, scenes: found.scenes });
  }
  // A sheet that isn't shared answers with Google's sign-in page, not a CSV.
  if (!res.ok || !type.includes('text/csv')) {
    return Response.json(
      {
        error:
          res.status === 404
            ? 'Google couldn’t find that sheet (or that tab). Check the link.'
            : // Google answers 400 for a tab (gid) the sheet no longer has — deleted, or the scenes moved to a new tab.
              res.status === 400
              ? 'That tab isn’t in the sheet any more (it was deleted, or the scenes moved to another tab). Open the scenes’ tab in the sheet, copy its link (it ends in #gid=…), and use it in Generate Scenes from Google Sheet.'
              : 'Google wouldn’t share that sheet. In the sheet, click Share → General access → “Anyone with the link” (Viewer), then try again.',
      },
      { status: 400 },
    );
  }
  const scenes = mapSheetScenes(parseCsv(await res.text()));
  return Response.json({ sheetId: sheet.sheetId, gid: sheet.gid, scenes });
}
