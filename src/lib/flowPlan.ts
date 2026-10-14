import { createHash } from 'node:crypto';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { anthropicModel } from './anthropicModel';

/**
 * "Smart jumps" — server-side only.
 *
 * A NAV step can only target a playbook, and a jump always lands on that
 * playbook's step 1. That's right for moving to a *different* playbook, but
 * when a NAV points back at its *own* playbook ("if the patient says doctor,
 * go to Playbook 3A" from inside 3A) it just restarts the playbook and the
 * conversation loops. What the designer meant is a specific step — and,
 * because the engine reads the table top to bottom, usually also a skip
 * afterwards so one branch's rows don't run straight into the next
 * branch's ("which doctor?" must not be followed by "what kind of
 * specialist?").
 *
 * So for each playbook containing a self-pointing NAV, Claude reads the
 * table once and works out those jumps and skips. The result is cached by
 * the table's content — every turn after that follows it exactly, with no
 * extra model call, and it's only redone when the table changes.
 */

type StepOption = 'BOT' | 'USER' | 'NAV';
type PlanStep = { id: string; option: StepOption; instruction: string; navTarget?: string; variable?: string };
type PlanBox = { id: string; label: string; steps: PlanStep[] };

/** A step-level move inside one playbook. `toIndex` is 0-based; `stepId` is the step it applies to. */
export type PlanMove = { stepId: string; toIndex: number; reason: string };

export type BoxPlan = {
  /** A self-pointing NAV step → the step it should really jump to. */
  jumps: PlanMove[];
  /** After this step finishes, continue at `toIndex` instead of the next row. Always forward. */
  skips: PlanMove[];
};

/** Keyed by playbook (box) id. Only playbooks that needed a plan appear. */
export type FlowPlans = Record<string, BoxPlan>;

export function needsPlan(box: PlanBox): boolean {
  return box.steps.some((s) => s.option === 'NAV' && s.navTarget === box.id);
}

function contentKey(box: PlanBox, boxes: PlanBox[]): string {
  const labelOf = (id?: string) => boxes.find((b) => b.id === id)?.label ?? '';
  const shape = box.steps.map((s) => [s.id, s.option, s.instruction, s.variable ?? '', s.navTarget ?? '', labelOf(s.navTarget)]);
  return createHash('sha1').update(JSON.stringify([box.id, box.label, shape])).digest('hex');
}

// In-flight and finished plans share one map, so two requests arriving
// together (e.g. the prewarm and the phone's first turn) make one call.
// Failures are dropped from the cache so the next request retries.
const cache = new Map<string, Promise<BoxPlan>>();

async function computePlan(model: ReturnType<typeof anthropicModel>, box: PlanBox, boxes: PlanBox[]): Promise<BoxPlan> {
  const table = box.steps
    .map((s, i) => {
      const variable = s.variable ? ` [saves: ${s.variable}]` : '';
      const target =
        s.option !== 'NAV'
          ? ''
          : s.navTarget === box.id
            ? '   → THIS SAME PLAYBOOK (needs a step)'
            : `   → playbook "${boxes.find((b) => b.id === s.navTarget)?.label ?? '?'}"`;
      return `${i + 1}. ${s.option}: ${s.instruction}${variable}${target}`;
    })
    .join('\n');

  const { output } = await generateText({
    model,
    output: Output.object({
      schema: z.object({
        jumps: z.array(z.object({ navStep: z.number().int(), toStep: z.number().int(), reason: z.string() })),
        skips: z.array(z.object({ afterStep: z.number().int(), toStep: z.number().int(), reason: z.string() })),
      }),
    }),
    system:
      'You are reading one playbook from a voice-agent conversation design. A deterministic engine runs its ' +
      'step table top to bottom: BOT = the agent says this, USER = wait for the caller and capture their answer, ' +
      'NAV = a branch (consecutive NAV rows are alternatives, chosen by what the caller just said).\n\n' +
      'Some NAV rows point back to THIS SAME PLAYBOOK. Taken literally they would restart it at step 1 and loop. ' +
      'The designer meant a specific step instead. Work out:\n' +
      '1. jumps — for every NAV row marked "THIS SAME PLAYBOOK", the step number it should go to (e.g. "if they ' +
      'say doctor" → the step that asks which doctor; "wants to change the time" → the step that asks for the ' +
      'time again). Use step 1 only if restarting the playbook really is what it means.\n' +
      '2. skips — places where, after finishing a step, the conversation must continue at a LATER step rather ' +
      'than the next row, because the following rows belong to a different branch (e.g. after the doctor ' +
      'branch\'s last step, skip past the specialist branch to where both branches rejoin). Only add a skip where ' +
      'running straight on would clearly be wrong. Skips only go forward.\n\n' +
      'Use step numbers exactly as listed. Give a short plain-English reason for each.',
    prompt: `Playbook "${box.label}":\n${table}`,
    maxOutputTokens: 1500,
  });

  const n = box.steps.length;
  const inRange = (step: number) => Number.isInteger(step) && step >= 1 && step <= n;
  const jumps: PlanMove[] = [];
  for (const j of output.jumps) {
    const step = box.steps[j.navStep - 1];
    if (!inRange(j.navStep) || !inRange(j.toStep) || step.option !== 'NAV' || step.navTarget !== box.id) continue;
    if (box.steps[j.toStep - 1].option === 'NAV' || jumps.some((m) => m.stepId === step.id)) continue;
    jumps.push({ stepId: step.id, toIndex: j.toStep - 1, reason: j.reason });
  }
  const skips: PlanMove[] = [];
  for (const s of output.skips) {
    const step = box.steps[s.afterStep - 1];
    // Forward only (no new loops), never onto a NAV row, never from one, and
    // only when it actually skips something.
    if (!inRange(s.afterStep) || !inRange(s.toStep) || s.toStep <= s.afterStep + 1) continue;
    if (step.option === 'NAV' || box.steps[s.toStep - 1].option === 'NAV' || skips.some((m) => m.stepId === step.id)) continue;
    skips.push({ stepId: step.id, toIndex: s.toStep - 1, reason: s.reason });
  }
  return { jumps, skips };
}

export function getBoxPlan(model: ReturnType<typeof anthropicModel>, box: PlanBox, boxes: PlanBox[]): Promise<BoxPlan> {
  const key = contentKey(box, boxes);
  let plan = cache.get(key);
  if (!plan) {
    plan = computePlan(model, box, boxes);
    cache.set(key, plan);
    plan.catch(() => cache.delete(key));
  }
  return plan;
}

/** Plans every playbook that needs one, in parallel. A playbook whose plan fails is simply left out. */
export async function getFlowPlans(model: ReturnType<typeof anthropicModel>, boxes: PlanBox[]): Promise<FlowPlans> {
  const entries = await Promise.all(
    boxes.filter(needsPlan).map(async (box) => {
      try {
        return [box.id, await getBoxPlan(model, box, boxes)] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e) => e !== null));
}
