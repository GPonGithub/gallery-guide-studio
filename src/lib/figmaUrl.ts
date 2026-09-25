/** Shared between the client (Generate Steps / connect flow) and the
 * sync-figma route, so the file-key/node-id parsing rule only lives once. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } | null {
  const fileMatch = /figma\.com\/(?:board|design|file)\/([0-9a-zA-Z]+)/.exec(url);
  if (!fileMatch) return null;
  const nodeMatch = /node-id=([0-9]+)-([0-9]+)/.exec(url);
  return { fileKey: fileMatch[1], nodeId: nodeMatch ? `${nodeMatch[1]}:${nodeMatch[2]}` : '0:1' };
}
