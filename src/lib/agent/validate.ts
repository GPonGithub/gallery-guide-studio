import { startStage } from './flow';
import { END, type AgentFlow } from './types';

/**
 * Plain-English problems that would make a flow misbehave when run — shown
 * after generating or importing, so they can be fixed on the board.
 */
export function validateFlow(flow: AgentFlow): string[] {
  const problems: string[] = [];
  const codes = new Set(flow.stages.map((s) => s.code));
  const slotNames = new Set(flow.stages.flatMap((s) => s.collect.map((c) => c.name)));

  if (flow.stages.length === 0) return ['There are no stages yet.'];

  const seen = new Set<string>();
  for (const stage of flow.stages) {
    if (seen.has(stage.code)) problems.push(`Two stages use code ${stage.code}.`);
    seen.add(stage.code);
    const where = `Stage ${stage.code}`;
    if (!stage.goal.trim()) problems.push(`${where} has no goal.`);
    for (const exit of stage.exits) {
      if (!exit.to) problems.push(`${where} has an exit with no destination.`);
      else if (exit.to !== END && !codes.has(exit.to)) problems.push(`${where} has an exit to ${exit.to}, which doesn't exist.`);
      if (!exit.onComplete && !exit.when.trim()) problems.push(`${where} has an exit to ${exit.to} with no "when".`);
    }
    const automatic = stage.exits.filter((e) => e.onComplete);
    if (automatic.length > 1) {
      problems.push(
        `${where} has ${automatic.length} automatic ("when goal met") exits — only the first (→ ${automatic[0].to}) is ever ` +
          'used. Turn the others into "→ CODE when <condition>" exits.',
      );
    }
    if (stage.exits.length === 0 && flow.globalExits.length === 0) {
      problems.push(`${where} has no exits — the conversation can't move on or end from there.`);
    }
    for (const cue of stage.cues) {
      if (cue.on === 'slot' && cue.slot && !slotNames.has(cue.slot)) {
        problems.push(`${where}: cue ${cue.name} waits for "${cue.slot}", which no stage collects.`);
      }
    }
  }
  for (const exit of flow.globalExits) {
    if (exit.to !== END && !codes.has(exit.to)) problems.push(`An "any stage" exit goes to ${exit.to}, which doesn't exist.`);
  }

  // Reachability from the start, and whether any route reaches END.
  const start = startStage(flow);
  const next = (code: string) => [
    ...(flow.stages.find((s) => s.code === code)?.exits.map((e) => e.to) ?? []),
    ...flow.globalExits.map((e) => e.to),
  ];
  const reached = new Set<string>();
  let endReachable = false;
  const queue = start ? [start.code] : [];
  while (queue.length > 0) {
    const code = queue.shift()!;
    if (reached.has(code)) continue;
    reached.add(code);
    for (const to of next(code)) {
      if (to === END) endReachable = true;
      else if (codes.has(to) && !reached.has(to)) queue.push(to);
    }
  }
  const unreachable = flow.stages.filter((s) => !reached.has(s.code)).map((s) => s.code);
  if (unreachable.length > 0) problems.push(`No route from stage ${start?.code} reaches: ${unreachable.join(', ')}.`);
  if (!endReachable) problems.push('No route ever reaches END — calls can never finish.');
  return problems;
}
