import { mapSheetScenes, parseCsv, type SheetScene } from './sheetScenes';

/**
 * Server side: a sheet's scenes tab, found again when the one a team linked has gone (2026-11-18 — Team AE's
 * scenes pointed at tab gid=0 after the scenes moved to a new tab and the old one was deleted). Only ever
 * Google's own addresses, built from the sheet's id.
 */

const exportUrl = (sheetId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

export function fetchSheetCsv(sheetId: string, gid: string): Promise<Response> {
  return fetch(exportUrl(sheetId, gid), { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
}

/** The sheet's tabs (gids), in order, from its "Anyone with the link" view. */
async function sheetTabs(sheetId: string): Promise<string[]> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return [...new Set([...html.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
  } catch {
    return [];
  }
}

/** The first tab (other than `missing`) that holds scenes, with them — or null. */
export async function findScenesTab(
  sheetId: string,
  missing: string,
): Promise<{ gid: string; scenes: SheetScene[] } | null> {
  for (const gid of await sheetTabs(sheetId)) {
    if (gid === missing) continue;
    try {
      const res = await fetchSheetCsv(sheetId, gid);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/csv')) continue;
      const scenes = mapSheetScenes(parseCsv(await res.text()));
      if (scenes.length > 0) return { gid, scenes };
    } catch {
      // That tab couldn't be read: try the next.
    }
  }
  return null;
}
