/**
 * Student teams. Each team gets its own copy of the whole app in this browser:
 * keys, scenes, conversations, patients, media folder and connections, layout —
 * nothing is shared. Team ED keeps the app's original storage (so work from
 * before teams existed stays with ED); every other team's localStorage keys carry a
 * "team-<name>:" prefix (e.g. "team-AE:") and its IndexedDB is a separate database (browserDb.ts).
 * "Graham" is a third copy, labelled with the name alone.
 *
 * The split is made by TEAM_STORAGE_SCRIPT, run in the root layout before any
 * of the app's code: it fixes the team for the page and makes localStorage
 * read and write only that team's keys. Switching team saves the choice and
 * reloads the page.
 */

export const TEAMS = ['ED', 'AE', 'Graham'] as const;
export type Team = (typeof TEAMS)[number];

/** The one localStorage key all teams share: which team this browser is on. */
const TEAM_KEY = 'studio-team';

const isTeam = (t: unknown): t is Team => (TEAMS as readonly unknown[]).includes(t);

/**
 * A setting name a project file must never write: the shared "which team" key, or a name carrying a
 * team's "team-<name>:" prefix. Exports never contain these (each team sees its own names unprefixed),
 * but a hand-edited file could — and for team ED, whose names aren't prefixed, writing "team-Graham:…"
 * would land straight in Graham's copy.
 */
export const isTeamControlKey = (name: string) =>
  name === TEAM_KEY || TEAMS.some((t) => t !== 'ED' && name.startsWith(`team-${t}:`));

/** The button's words: "Team ED", "Team AE", "Graham". */
export const teamLabel = (t: Team) => (t === 'Graham' ? 'Graham' : `Team ${t}`);

/** How a team is named in an exported file's name: "team-ED", "team-AE", "Graham". */
export const teamFileTag = (t: Team) => (t === 'Graham' ? 'Graham' : `team-${t}`);

/** The team a file's name is labelled with ("…team-AE…", "…Graham…"), or null. */
export function teamInFileName(name: string): Team | null {
  if (/team[-_ ]?AE\b/i.test(name)) return 'AE';
  if (/team[-_ ]?ED\b/i.test(name)) return 'ED';
  if (/\bGraham\b/i.test(name)) return 'Graham';
  return null;
}

/**
 * Whether a file may be imported into the team this page is on. Every exported JSON file says which team
 * it came from (a "team" field, and the team in its name); it goes back into that team only, so one team's
 * file can never overwrite another team's work. A file with no team in it falls back to its name. Returns
 * a plain-English reason it can't, or null when it can.
 */
export function teamImportProblem(fileTeam: unknown, fileName = ''): string | null {
  const here = currentTeam();
  const from = isTeam(fileTeam) ? fileTeam : teamInFileName(fileName);
  if (!from) {
    return (
      `“${fileName || 'This file'}” doesn’t say which team it belongs to, so it isn’t opened — that keeps it from ` +
      `overwriting another team’s work. Export it again from its team, or add “${teamFileTag(here)}” to its name ` +
      `if it really is ${teamLabel(here)}’s.`
    );
  }
  if (from !== here) {
    return (
      `“${fileName || 'This file'}” belongs to ${teamLabel(from)}, and this page is ${teamLabel(here)}. It can only be ` +
      `opened in ${teamLabel(from)}: switch to ${teamLabel(from)} (top bar) and open it there.`
    );
  }
  return null;
}

/** The team this page was loaded as. */
export function currentTeam(): Team {
  if (typeof window === 'undefined') return 'ED';
  const t = (window as { __studioTeam?: unknown }).__studioTeam;
  return isTeam(t) ? t : 'ED';
}

export function switchTeam(team: Team) {
  if (team === currentTeam()) return;
  try {
    window.localStorage.setItem(TEAM_KEY, team);
  } catch {
    return; // no storage — nowhere to keep the team apart in
  }
  window.location.reload();
}

export const TEAM_STORAGE_SCRIPT = `(function () {
  if (window.__studioTeam) return;
  var KEY = ${JSON.stringify(TEAM_KEY)}, TEAMS = ${JSON.stringify(TEAMS)};
  var ls;
  try { ls = window.localStorage; } catch (e) { return; }
  var proto = Storage.prototype;
  var get = proto.getItem, set = proto.setItem, rem = proto.removeItem, key = proto.key;
  var len = Object.getOwnPropertyDescriptor(proto, 'length').get;
  var team = 'ED';
  try { var saved = get.call(ls, KEY); if (TEAMS.indexOf(saved) >= 0) team = saved; } catch (e) {}
  window.__studioTeam = team;
  // ED keeps unprefixed keys; every other team's keys start with "team-<name>:".
  var ae = team !== 'ED', P = 'team-' + team + ':';
  function anyTeam(k) { return k.indexOf('team-') === 0 && TEAMS.some(function (t) { return t !== 'ED' && k.indexOf('team-' + t + ':') === 0; }); }
  function scoped(k) { k = String(k); return k === KEY || !ae ? k : P + k; }
  function mine(k) { return ae ? k.indexOf(P) === 0 : k !== KEY && !anyTeam(k); }
  function keys(s) {
    var out = [];
    for (var i = 0; i < len.call(s); i++) { var k = key.call(s, i); if (k !== null && mine(k)) out.push(k); }
    return out;
  }
  proto.getItem = function (k) { return get.call(this, this === ls ? scoped(k) : k); };
  proto.setItem = function (k, v) { return set.call(this, this === ls ? scoped(k) : k, v); };
  proto.removeItem = function (k) { return rem.call(this, this === ls ? scoped(k) : k); };
  proto.key = function (i) {
    if (this !== ls) return key.call(this, i);
    var k = keys(this)[i];
    return k === undefined ? null : ae ? k.slice(P.length) : k;
  };
  proto.clear = (function (clear) {
    return function () {
      if (this !== ls) return clear.call(this);
      var s = this;
      keys(s).forEach(function (k) { rem.call(s, k); });
    };
  })(proto.clear);
  Object.defineProperty(proto, 'length', {
    configurable: true,
    enumerable: true,
    get: function () { return this === ls ? keys(this).length : len.call(this); },
  });
})();`;

// Backup for a page where the layout's script didn't run (e.g. a dev server still
// serving an older layout): run it the moment this module loads — before the
// studio reads its storage, since browserDb.ts and the team switch import it.
if (typeof window !== 'undefined' && !(window as { __studioTeam?: Team }).__studioTeam) {
  new Function(TEAM_STORAGE_SCRIPT)();
}
