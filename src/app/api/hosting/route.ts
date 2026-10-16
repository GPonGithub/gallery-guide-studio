import { figjamStoreReady } from '@/lib/figmaJobStore';
import { isHosted } from '@/lib/serverKeys';

// What the page needs to know about where it's running: a hosted copy
// doesn't send TouchDesigner cues, and its FigJam plugin connection needs a
// connection code and the shared job store (see figmaJobStore).
export function GET() {
  return Response.json({ hosted: isHosted, figjamReady: !isHosted || figjamStoreReady() });
}
