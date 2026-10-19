/**
 * Student teams. Each team gets its own copy of the whole app in this browser:
 * keys, scenes, conversations, patients, media folder and connections, layout —
 * nothing is shared. Team ED keeps the app's original storage (so work from
 * before teams existed stays with ED); team AE's localStorage keys carry a
 * "team-AE:" prefix and its IndexedDB is a separate database (browserDb.ts).
 *
 * The split is made by TEAM_STORAGE_SCRIPT, run in the root layout before any
 * of the app's code: it fixes the team for the page and makes localStorage
 * read and write only that team's keys. Switching team saves the choice and
 * reloads the page.
 */

export const TEAMS = ['ED', 'AE'] as const;
export type Team = (typeof TEAMS)[number];

/** The one localStorage key both teams share: which team this browser is on. */
const TEAM_KEY = 'studio-team';
const PREFIX = 'team-AE:';

/** The team this page was loaded as. */
export function currentTeam(): Team {
  if (typeof window === 'undefined') return 'ED';
  return (window as { __studioTeam?: Team }).__studioTeam === 'AE' ? 'AE' : 'ED';
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
  var KEY = ${JSON.stringify(TEAM_KEY)}, P = ${JSON.stringify(PREFIX)};
  var ls;
  try { ls = window.localStorage; } catch (e) { return; }
  var proto = Storage.prototype;
  var get = proto.getItem, set = proto.setItem, rem = proto.removeItem, key = proto.key;
  var len = Object.getOwnPropertyDescriptor(proto, 'length').get;
  var team = 'ED';
  try { if (get.call(ls, KEY) === 'AE') team = 'AE'; } catch (e) {}
  window.__studioTeam = team;
  var ae = team === 'AE';
  function scoped(k) { k = String(k); return k === KEY || !ae ? k : P + k; }
  function mine(k) { return ae ? k.indexOf(P) === 0 : k !== KEY && k.indexOf(P) !== 0; }
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
