// Fallback reference frame for a session that has never synced a board yet
// (no image, no boxes) — sized generously enough that it's never really
// seen in practice. Once a real sync/reset succeeds, `sync-figma`'s
// response carries the *actual* board's own bounding-box pixel size
// (`boardExtent`, stored as `StudioState.figmaBoardExtent`), and
// PlaybookCanvas.tsx renders against that instead — real percentages need
// to be interpreted against the real pixel frame they were computed from,
// or spacing and card size come out stretched/squished.
export const VIRTUAL_CANVAS = { width: 4000, height: 6000 };
