import type { PlaybookBox } from '@/lib/types';

export const maxDuration = 30;

const LABEL_PATTERN = /^playbook\b/i;
const BUTTON_TEXT_PATTERN = /^open playbook editor$/i;

type FigmaEndpoint = { endpointNodeId?: string } | string | null | undefined;

type FigmaNode = {
  id: string;
  type?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  children?: FigmaNode[];
  characters?: string;
  text?: { characters?: string } | string;
  connectorStart?: FigmaEndpoint;
  connectorEnd?: FigmaEndpoint;
};

function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } | null {
  const fileMatch = /figma\.com\/(?:board|design|file)\/([0-9a-zA-Z]+)/.exec(url);
  if (!fileMatch) return null;
  const nodeMatch = /node-id=([0-9]+)-([0-9]+)/.exec(url);
  return { fileKey: fileMatch[1], nodeId: nodeMatch ? `${nodeMatch[1]}:${nodeMatch[2]}` : '0:1' };
}

function collectNodes(node: FigmaNode, out: FigmaNode[]) {
  out.push(node);
  for (const child of node.children ?? []) collectNodes(child, out);
}

function getText(node: FigmaNode): string {
  if (typeof node.characters === 'string') return node.characters;
  if (typeof node.text === 'string') return node.text;
  if (node.text && typeof node.text === 'object' && typeof node.text.characters === 'string') {
    return node.text.characters;
  }
  return '';
}

function getEndpointId(endpoint: FigmaEndpoint): string | null {
  if (typeof endpoint === 'string') return endpoint;
  if (endpoint && typeof endpoint === 'object' && typeof endpoint.endpointNodeId === 'string') {
    return endpoint.endpointNodeId;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { fileUrl, figmaApiKey } = (await req.json()) as { fileUrl?: string; figmaApiKey?: string };
    if (!figmaApiKey?.trim()) {
      return Response.json({ error: 'Add a Figma personal access token under "API keys" first.' }, { status: 400 });
    }
    const parsed = fileUrl ? parseFigmaUrl(fileUrl) : null;
    if (!parsed) {
      return Response.json({ error: "Couldn't recognize that as a Figma board URL." }, { status: 400 });
    }

    const res = await fetch(
      `https://api.figma.com/v1/files/${parsed.fileKey}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`,
      { headers: { 'X-Figma-Token': figmaApiKey } },
    );
    if (!res.ok) {
      const body = await res.text();
      return Response.json(
        { error: `Figma API error (${res.status}): ${body.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { nodes?: Record<string, { document?: FigmaNode }> };
    const entry = data.nodes?.[parsed.nodeId] ?? Object.values(data.nodes ?? {})[0];
    const root = entry?.document;
    if (!root) {
      return Response.json({ error: 'Figma returned no content for that board/node.' }, { status: 502 });
    }

    const allNodes: FigmaNode[] = [];
    collectNodes(root, allNodes);

    // FigJam represents each card as up to three separate overlapping shapes
    // (the title bar, the body text, the decorative "Open playbook editor"
    // button) rather than one node — group by position to reassemble them.
    type Shape = { id: string; text: string; box: NonNullable<FigmaNode['absoluteBoundingBox']> };
    const shapes: Shape[] = allNodes
      .filter((n): n is FigmaNode & { absoluteBoundingBox: NonNullable<FigmaNode['absoluteBoundingBox']> } =>
        n.type === 'SHAPE_WITH_TEXT' && Boolean(n.absoluteBoundingBox),
      )
      .map((n) => ({ id: n.id, text: getText(n).trim(), box: n.absoluteBoundingBox }))
      .filter((s) => s.text && !BUTTON_TEXT_PATTERN.test(s.text));

    const posKey = (b: Shape['box']) => `${Math.round(b.x)}:${Math.round(b.y)}`;
    const byPos = new Map<string, Shape[]>();
    for (const s of shapes) {
      const key = posKey(s.box);
      const list = byPos.get(key) ?? [];
      list.push(s);
      byPos.set(key, list);
    }

    type ParsedBox = { figmaId: string; label: string; instructions: string; box: Shape['box'] };
    const parsedBoxes: ParsedBox[] = [];
    const seen = new Set<string>();
    for (const s of shapes) {
      if (seen.has(s.id)) continue;
      const group = byPos.get(posKey(s.box)) ?? [s];
      const labelShape = group.find((g) => LABEL_PATTERN.test(g.text));
      const contentShape = group.find((g) => g !== labelShape) ?? s;
      seen.add(contentShape.id);
      if (labelShape) seen.add(labelShape.id);
      parsedBoxes.push({
        figmaId: contentShape.id,
        label: (labelShape ? labelShape.text : contentShape.text.slice(0, 40)).trim(),
        instructions: contentShape.text.trim(),
        box: contentShape.box,
      });
    }

    if (parsedBoxes.length === 0) {
      return Response.json({ error: "Couldn't find any playbook boxes in that Figma node." }, { status: 422 });
    }

    const connectorEndpoints = allNodes
      .filter((n) => n.type === 'CONNECTOR')
      .map((n) => ({ from: getEndpointId(n.connectorStart), to: getEndpointId(n.connectorEnd) }))
      .filter((c): c is { from: string; to: string } => Boolean(c.from && c.to));

    // A PNG exported from Figma via "Export selection" crops to the full
    // visual extent of everything selected — including the connector
    // *arrows*, which routinely swing out well beyond the boxes themselves
    // (e.g. a loop-back arrow arcing around the whole diagram). Normalizing
    // against only the box shapes' bounds would compute a smaller canvas
    // than the PNG actually is, shifting and skewing every box relative to
    // it. Measure every visible node's bounding box, not just the boxes.
    const allBoundingBoxes = allNodes
      .filter((n) => n.type === 'SHAPE_WITH_TEXT' || n.type === 'CONNECTOR')
      .map((n) => n.absoluteBoundingBox)
      .filter((b): b is NonNullable<FigmaNode['absoluteBoundingBox']> => Boolean(b));
    const boundsSource = allBoundingBoxes.length > 0 ? allBoundingBoxes : parsedBoxes.map((b) => b.box);

    const contentMinX = Math.min(...boundsSource.map((b) => b.x));
    const contentMaxX = Math.max(...boundsSource.map((b) => b.x + b.width));
    const contentMinY = Math.min(...boundsSource.map((b) => b.y));
    const contentMaxY = Math.max(...boundsSource.map((b) => b.y + b.height));
    const contentSpanX = Math.max(contentMaxX - contentMinX, 1);
    const contentSpanY = Math.max(contentMaxY - contentMinY, 1);

    // Figma's "Export selection" doesn't crop tight to the content — it
    // leaves a margin around it (measured directly against a real export:
    // content filled ~92% of the PNG's width and ~90% of its height,
    // centered, on a 6536x5168 image with a clean 256px border on every
    // side). Normalizing straight to 0-100% ignores that margin and maps
    // content edge-to-edge, which is what made every box come out too big
    // and shifted toward the top-left relative to the actual PNG. Expand
    // the measured content bounds by the same margin so the final 0-100%
    // range matches what the export actually looks like.
    const CONTENT_FRACTION_X = 0.92;
    const CONTENT_FRACTION_Y = 0.9;
    const spanX = contentSpanX / CONTENT_FRACTION_X;
    const spanY = contentSpanY / CONTENT_FRACTION_Y;
    const minX = contentMinX - (spanX - contentSpanX) / 2;
    const minY = contentMinY - (spanY - contentSpanY) / 2;

    const idMap = new Map<string, string>();
    for (const b of parsedBoxes) idMap.set(b.figmaId, crypto.randomUUID());

    const boxes: PlaybookBox[] = parsedBoxes.map((b) => {
      const leadsTo = connectorEndpoints
        .filter((c) => c.from === b.figmaId)
        .map((c) => idMap.get(c.to))
        .filter((id): id is string => Boolean(id));
      return {
        id: idMap.get(b.figmaId)!,
        label: b.label || 'Untitled',
        instructions: b.instructions,
        x: ((b.box.x - minX) / spanX) * 100,
        y: ((b.box.y - minY) / spanY) * 100,
        width: (b.box.width / spanX) * 100,
        height: (b.box.height / spanY) * 100,
        leadsTo,
      };
    });

    // Debug info only — lets us compare the computed canvas bounds against
    // Figma's own "Export selection" panel dimensions to calibrate exactly,
    // instead of guessing at another correction heuristic blindly.
    return Response.json({ boxes, debugBounds: { minX, minY, spanX, spanY } });
  } catch (err) {
    console.error('sync-figma failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Sync failed. Check the file URL and token, then try again.' }, { status: 500 });
  }
}
