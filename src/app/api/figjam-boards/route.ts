import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanBoards, FIGJAM_BOARDS, type FigjamBoard } from '@/lib/figjamBoards';
import { isHosted } from '@/lib/serverKeys';

// The list of FigJam boards students pick from. Anyone can read it; only the
// computer running the app can change it — never a hosted copy (its files
// can't be written, and students mustn't edit it) or the public phone-testing
// tunnel (every request it relays carries cf-connecting-ip).
const FILE = path.join(process.cwd(), 'src', 'data', 'figjamBoards.json');
const canEdit = (req: Request) => !isHosted && !req.headers.has('cf-connecting-ip');

export function GET(req: Request) {
  return Response.json({ boards: FIGJAM_BOARDS, editable: canEdit(req) });
}

export async function POST(req: Request) {
  if (!canEdit(req)) {
    return Response.json({ error: 'The board list can only be changed on the computer running the app.' }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { boards?: FigjamBoard[] } | null;
  const boards = Array.isArray(body?.boards) ? cleanBoards(body.boards) : null;
  if (!boards) {
    return Response.json({ error: 'Every link must be a FigJam board link (https://www.figma.com/board/…).' }, { status: 400 });
  }
  await writeFile(FILE, `${JSON.stringify({ boards }, null, 2)}\n`);
  return Response.json({ boards });
}
