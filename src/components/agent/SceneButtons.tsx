'use client';

/**
 * A row of numbered buttons, one per scene from the sheet — in sections 3–6
 * of the Design Process and above the room in the media panel. Every row shows the open scene highlighted and switches scenes
 * the same way, so they always agree.
 */
export function SceneButtons({
  scenes,
  currentId,
  onSwitch,
  disabled = false,
  label = 'Scenes from the sheet',
  tourId,
}: {
  scenes: { id: string; number: string; name: string }[];
  currentId: string | null;
  onSwitch: (id: string) => void;
  disabled?: boolean;
  label?: string;
  /** Marks it for the onboarding tour. */
  tourId?: string;
}) {
  if (scenes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label} data-tour={tourId}>
      {scenes.map((s) => {
        const selected = s.id === currentId;
        return (
          <button
            key={s.id}
            onClick={() => !selected && onSwitch(s.id)}
            disabled={disabled}
            aria-pressed={selected}
            title={`Scene ${s.number} · ${s.name}`}
            className={`h-9 min-w-9 border-2 px-2 font-label text-[12px] tabular-nums transition-colors ${
              selected ? 'border-ink bg-ink text-paper' : 'border-ink bg-paper text-ink hover:bg-muted'
            } disabled:opacity-50`}
          >
            {s.number}
          </button>
        );
      })}
    </div>
  );
}
