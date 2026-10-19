'use client';

import { useSyncExternalStore } from 'react';
import { buttonOutline } from '@/lib/styles';
import { currentTeam, switchTeam, TEAMS } from '@/lib/team';

const noSubscribe = () => () => {};
/** The open team's button: the outline button with Complete restart's 4px border. */
const thick = buttonOutline.replace('border-2 ', 'border-4 ');

/**
 * Team ED / Team AE: each team has its own copy of the whole app in this
 * browser (see lib/team.ts). Both are white with black text (black on hover);
 * the open team has the thick border of Complete restart. Clicking the other
 * reloads the page as that team.
 */
export function TeamToggle() {
  // The server can't know the team, so it draws ED and the browser corrects it.
  const team = useSyncExternalStore(noSubscribe, currentTeam, () => 'ED');
  return (
    <div role="group" aria-label="Student team" className="flex gap-2" data-tour="team-toggle">
      {TEAMS.map((t) => (
        <button
          key={t}
          onClick={() => switchTeam(t)}
          aria-pressed={team === t}
          title={team === t ? `You're working as Team ${t}` : `Switch to Team ${t}'s own copy of the app`}
          className={`h-10 ${team === t ? `${thick} cursor-default` : buttonOutline}`}
        >
          Team {t}
        </button>
      ))}
    </div>
  );
}
