import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import { validateFlow } from './validate';
import { END, type AgentFlow, type Stage } from './types';

/**
 * Brief → flow. Claude designs the stages from a student's plain-English
 * description; validateFlow checks the result, and if it finds structural
 * problems Claude gets one chance to fix them — returning only the stages
 * that change, not a whole second design.
 *
 * When there's already a design and the description has only changed a
 * little (the usual case — a few edits in the sheet), reviseFlow sends
 * Claude the current design plus what changed, and gets back only what must
 * change: far less to write, so far quicker, and anything the student edited
 * by hand (in the app or on the FigJam board) is kept.
 *
 * Thinking is off: it adds time and this is a writing task.
 */

const NO_THINKING = { anthropic: { thinking: { type: 'disabled' as const } } };

const exitSchema = z.object({
  to: z.string().describe('Target stage code, or "END" to finish the call'),
  when: z.string().describe('Plain-English condition from the caller\'s side, or a short note for an automatic exit'),
  onComplete: z.boolean().describe('true = taken automatically once this stage\'s goal is met'),
});

const cueSchema = z.object({
  name: z.string().describe('UPPER_SNAKE_CASE message for TouchDesigner'),
  on: z.enum(['enter', 'complete', 'exit', 'slot', 'moment']),
  slot: z.string().optional().describe('For on="slot": the information name'),
  when: z.string().optional().describe('For on="moment": the moment in plain English'),
});

const stageSchema = z.object({
  code: z.string(),
  name: z.string().describe('UPPER CASE, a few words'),
  goal: z.string(),
  collect: z.array(z.object({ name: z.string(), description: z.string(), required: z.boolean() })),
  instructions: z.string(),
  steering: z.enum(['strict', 'balanced', 'relaxed']),
  exits: z.array(exitSchema),
  cues: z.array(cueSchema),
});

const flowSchema = z.object({
  name: z.string().describe('Short name for the flow, e.g. "UCSF front desk"'),
  persona: z.string(),
  rules: z.string().describe('One rule per line'),
  globalExits: z.array(exitSchema),
  globalCues: z.array(cueSchema),
  stages: z.array(stageSchema),
});

/** Only what changes: stages to add or replace (by code), codes to remove, and master fields only if they change. */
const patchSchema = z.object({
  summary: z.string().describe('One short line: what changed in the design, for the student'),
  upsert: z.array(stageSchema).describe('Stages to add, or to replace entirely (same code) — only ones that must change'),
  remove: z.array(z.string()).describe('Codes of stages to delete'),
  persona: z.string().optional().describe('Only if it must change'),
  rules: z.string().optional().describe('Only if they must change'),
  globalExits: z.array(exitSchema).optional().describe('Only if they must change: the complete new list'),
  globalCues: z.array(cueSchema).optional().describe('Only if they must change: the complete new list'),
});

const SYSTEM = `You design conversation flows for a voice-agent prototyping tool used by design students.

HOW THE AGENT WORKS
The conversation is split into STAGES. Each stage has one GOAL and a list of INFORMATION TO COLLECT. Inside a stage an LLM talks freely to reach the goal, answers side questions briefly and steers the caller back. Code moves between stages through EXITS:
- An automatic exit (onComplete=true) is taken once the stage's goal is met and every required item is collected.
- A conditional exit (onComplete=false) is taken whenever the caller's words match its "when" condition.
- Global exits apply from every stage (e.g. an emergency at any point).
- "END" finishes the call; the agent then says a polite goodbye.
TD CUES are messages sent to TouchDesigner (to trigger video/light/sound) on: entering a stage, the goal being met, leaving a stage, a piece of information being collected (slot), or a described moment.

DESIGN RULES
1. Read the brief for its intentions: who the agent is, who calls, what they want, and what must be achieved. Fill sensible gaps; don't invent features the brief doesn't imply.
2. One clear goal per stage. Stage "1" opens the call: greet, and find out what the caller needs (route them). Codes go by depth: 1, then 2A, 2B…, then 3A, 3B… so the flow reads left to right.
3. The caller must be able to complete each goal in turn: every stage reachable from stage 1, no dead ends, and every route eventually reaches END with a confirmation and goodbye.
4. Collect only what each goal needs. Information names are snake_case, unique across the whole flow. Mark required items; things that only apply sometimes ("doctor_name — if they want a doctor") are not required.
5. Prefer an automatic exit when a stage's job is simply done; use conditional exits for genuine choices the caller makes. A stage has AT MOST ONE automatic exit — if where to go next depends on what the caller said, make every option a conditional exit instead. For an automatic exit, "when" is a short note (or empty) — never the words "goal met". Never create a stage just to say one line.
6. Add global exits only where they are a real safety or escape need for this domain (emergency, wants a human, wants to stop).
7. Instructions say how to approach the goal: order of questions, what to confirm back, tone. Steering: strict for safety-critical or must-answer stages, balanced by default, relaxed for open-ended chat.
8. TD cues: if the brief mentions visuals, screens, video, lights, sound or TouchDesigner, place cues at the moments it describes. Otherwise add one "<STAGE>_ENTER" cue per stage as a placeholder students can repurpose.
9. Rules always include: voice conversation, short replies, one question at a time, never invent facts. Add domain rules the brief implies.
10. Usually 4–9 stages. Keep wording plain — students will edit this on a FigJam board.`;

type Generated = z.infer<typeof flowSchema>;
type GeneratedStage = z.infer<typeof stageSchema>;
type Patch = z.infer<typeof patchSchema>;

const upper = (s: string) => s.trim().toUpperCase();

function toStage(s: GeneratedStage, id: string): Stage {
  return {
    ...s,
    id,
    code: upper(s.code),
    exits: s.exits.map((e) => ({
      ...e,
      to: upper(e.to) === 'END' ? END : upper(e.to),
      when: e.onComplete ? e.when.trim().replace(/^(?:the\s+)?goal(?:\s+is)?\s+met\b[\s—–:,.-]*/i, '') : e.when.trim(),
    })),
  };
}

function toFlow(g: Generated): AgentFlow {
  return {
    name: g.name.trim(),
    persona: g.persona.trim(),
    rules: g.rules.trim(),
    globalExits: g.globalExits.map((e) => ({ ...e, to: upper(e.to), onComplete: false })),
    globalCues: g.globalCues,
    tdUrl: '',
    stages: g.stages.map((s, i) => toStage(s, `gen-${i}-${upper(s.code)}`)),
  };
}

/** The design as Claude reads it back (no ids or app settings). */
function asDesign(flow: AgentFlow) {
  return {
    name: flow.name ?? '',
    persona: flow.persona,
    rules: flow.rules,
    globalExits: flow.globalExits,
    globalCues: flow.globalCues,
    stages: flow.stages.map(({ code, name, goal, collect, instructions, steering, exits, cues }) => ({
      code,
      name,
      goal,
      collect,
      instructions,
      steering,
      exits,
      cues,
    })),
  };
}

/** Applies a patch: replaced stages keep their place (and id), new ones go at the end, removed ones go. */
export function applyPatch(flow: AgentFlow, patch: Patch): AgentFlow {
  const removed = new Set(patch.remove.map(upper));
  const byCode = new Map(patch.upsert.map((s) => [upper(s.code), s]));
  const stages = flow.stages
    .filter((s) => !removed.has(s.code))
    .map((s) => {
      const replacement = byCode.get(s.code);
      if (!replacement) return s;
      byCode.delete(s.code);
      return toStage(replacement, s.id);
    });
  const stamp = Date.now();
  for (const [code, added] of byCode) stages.push(toStage(added, `gen-${stamp}-${code}`));
  return {
    ...flow,
    persona: patch.persona?.trim() || flow.persona,
    rules: patch.rules?.trim() || flow.rules,
    globalExits: patch.globalExits ? patch.globalExits.map((e) => ({ ...e, to: upper(e.to), onComplete: false })) : flow.globalExits,
    globalCues: patch.globalCues ?? flow.globalCues,
    stages,
  };
}

/** Lines that were added or removed between two versions of the brief — to point Claude at the change. */
export function changedLines(before: string, after: string): string {
  const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const was = new Set(lines(before));
  const now = new Set(lines(after));
  const removed = [...was].filter((l) => !now.has(l)).map((l) => `- ${l}`);
  const added = [...now].filter((l) => !was.has(l)).map((l) => `+ ${l}`);
  return [...removed, ...added].join('\n') || '(only spacing or line order changed)';
}

const REVISE = `
REVISING AN EXISTING DESIGN
You are given the CURRENT DESIGN (which may include changes the student made by hand — keep them), the PREVIOUS BRIEF it was made from, the NEW BRIEF, and the lines that changed. Return ONLY what the change requires: stages to add or replace (give the complete stage, with the same code to replace one), codes of stages to remove, and persona/rules/global exits/global cues only if they must change. Leave everything else exactly as it is. Keep codes stable, keep every exit pointing at a stage that exists, and follow the design rules above. If nothing in the design needs to change, return empty lists.`;

/** Asks Claude for just the changes, and applies them. */
async function patchFlow(model: ReturnType<typeof anthropicModel>, flow: AgentFlow, task: string): Promise<{ flow: AgentFlow; summary: string }> {
  const { output } = await generateText({
    model,
    system: SYSTEM + REVISE,
    prompt: `CURRENT DESIGN:\n${JSON.stringify(asDesign(flow))}\n\n${task}`,
    output: Output.object({ schema: patchSchema }),
    maxOutputTokens: 8000,
    providerOptions: NO_THINKING,
  });
  return { flow: applyPatch(flow, output), summary: output.summary.trim() };
}

/** One chance to fix problems the checker found — as changes, not a whole second design. */
async function repair(model: ReturnType<typeof anthropicModel>, flow: AgentFlow, problems: string[], context: string) {
  if (problems.length === 0) return { flow, problems };
  try {
    const fixed = await patchFlow(
      model,
      flow,
      `${context}\n\nTHE DESIGN HAS THESE PROBLEMS — return only the changes that fix them:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    );
    const fixedProblems = validateFlow(fixed.flow);
    if (fixedProblems.length < problems.length) return { flow: fixed.flow, problems: fixedProblems };
  } catch {
    // Keep the design as it was, with its problems listed.
  }
  return { flow, problems };
}

export async function generateFlow(
  brief: string,
  anthropicApiKey: string,
  knowledge = '',
): Promise<{ flow: AgentFlow; problems: string[] }> {
  const model = anthropicModel(anthropicApiKey);
  // The knowledge base isn't designed here (students write it) but it tells
  // the designer what the agent will actually know — real services, names,
  // options — so the stages fit them. The agent gets it separately at run time.
  const context = knowledge.trim()
    ? `\n\nTHE AGENT'S KNOWLEDGE BASE (facts it will have at run time; design around them, don't copy them into instructions):\n${knowledge.trim()}`
    : '';
  const first = await generateText({
    model,
    system: SYSTEM,
    prompt: `BRIEF FROM THE STUDENT:\n${brief.trim()}${context}`,
    output: Output.object({ schema: flowSchema }),
    maxOutputTokens: 8000,
    providerOptions: NO_THINKING,
  });
  const flow = toFlow(first.output);
  return repair(model, flow, validateFlow(flow), `BRIEF FROM THE STUDENT:\n${brief.trim()}${context}`);
}

/**
 * The quick path: revise `flow` (generated from `previousBrief`, perhaps
 * edited since) for `brief`, changing only what the difference calls for.
 * Nothing changed → nothing is asked of Claude.
 */
export async function reviseFlow(
  previousBrief: string,
  brief: string,
  flow: AgentFlow,
  anthropicApiKey: string,
  knowledge = '',
): Promise<{ flow: AgentFlow; problems: string[]; summary: string; unchanged?: boolean }> {
  if (previousBrief.trim() === brief.trim()) return { flow, problems: validateFlow(flow), summary: '', unchanged: true };
  const model = anthropicModel(anthropicApiKey);
  const context = knowledge.trim()
    ? `\n\nTHE AGENT'S KNOWLEDGE BASE (facts it will have at run time; design around them, don't copy them into instructions):\n${knowledge.trim()}`
    : '';
  const task =
    `PREVIOUS BRIEF:\n${previousBrief.trim()}\n\nNEW BRIEF:\n${brief.trim()}${context}\n\n` +
    `WHAT CHANGED (- removed, + added):\n${changedLines(previousBrief, brief)}`;
  const revised = await patchFlow(model, flow, task);
  const checked = await repair(model, revised.flow, validateFlow(revised.flow), `NEW BRIEF:\n${brief.trim()}${context}`);
  return { ...checked, summary: revised.summary };
}
