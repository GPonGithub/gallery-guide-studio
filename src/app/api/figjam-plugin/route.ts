import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zip } from '@/lib/zip';

// The FigJam plugin as a download, for students using a hosted copy (they
// don't have the project's files). It's set up for the site it came from:
// that address is allowed in its manifest and filled in as its App address.
// It has its own plugin id, so it never shares settings with a copy
// imported from the project on the same computer.
// (next.config.ts makes sure figjam-plugin/ is deployed with this route.)
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const dir = path.join(process.cwd(), 'figjam-plugin');
  const [manifestText, code, ui] = await Promise.all(
    ['manifest.json', 'code.js', 'ui.html'].map((file) => readFile(path.join(dir, file), 'utf8')),
  );
  const manifest = JSON.parse(manifestText) as {
    id: string;
    name: string;
    networkAccess: { allowedDomains: string[]; reasoning?: string };
  };
  manifest.id = 'chatbot-designer-figjam-hosted';
  manifest.name = 'Chatbot Designer — FigJam';
  manifest.networkAccess.allowedDomains = ['https://api.anthropic.com', origin];
  manifest.networkAccess.reasoning =
    'Calls the Anthropic API with the designer’s own key, and polls Chatbot Designer at this address for drawing and import requests.';
  const files = [
    { name: 'chatbot-designer-figjam/manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: 'chatbot-designer-figjam/code.js', content: code },
    {
      name: 'chatbot-designer-figjam/ui.html',
      content: ui.replace("const DEFAULT_APP_ORIGIN = 'http://localhost:3000';", `const DEFAULT_APP_ORIGIN = ${JSON.stringify(origin)};`),
    },
  ];
  return new Response(new Blob([zip(files) as BlobPart]), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="chatbot-designer-figjam.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
