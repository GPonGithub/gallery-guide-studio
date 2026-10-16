import saved from '@/data/figjamBoards.json';

/**
 * The FigJam boards students can pick from (Design Process, section 6).
 * The list lives in src/data/figjamBoards.json — part of the project itself,
 * so every copy (a student's download, or the hosted app) comes with it. It's
 * edited in the app on the computer running it, which writes that file
 * (see /api/figjam-boards); commit the file to pass the list on.
 */
export type FigjamBoard = { name: string; url: string };

export const FIGJAM_BOARDS: FigjamBoard[] = (saved as { boards: FigjamBoard[] }).boards;

export const isBoardUrl = (url: string) => /^https:\/\/(www\.)?figma\.com\/(board|file)\/[A-Za-z0-9]+/.test(url.trim());

/** A readable name from a board link: …/board/KEY/Goal-Agent-Template → "Goal Agent Template". */
export function nameFromBoardUrl(url: string): string {
  const slug = /figma\.com\/(?:board|file)\/[A-Za-z0-9]+\/([^/?#]+)/.exec(url)?.[1];
  return slug ? decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim() : '';
}

/** Trimmed, named and checked; null if any link isn't a FigJam board link. */
export function cleanBoards(boards: FigjamBoard[]): FigjamBoard[] | null {
  const kept = boards
    .map((b) => ({ name: b.name.trim(), url: b.url.trim() }))
    .filter((b) => b.name || b.url)
    .map((b) => ({ name: b.name || nameFromBoardUrl(b.url) || 'FigJam board', url: b.url }));
  return kept.every((b) => isBoardUrl(b.url)) ? kept : null;
}
