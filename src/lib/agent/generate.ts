import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import { validateFlow } from './validate';
import { END, type AgentFlow } from './types';

/**
 * Brief → flow. Claude designs the stages from a student's plain-English
 * description; validateFlow checks the result, and if it finds structural
 * problems Claude gets one chance to fix its own design before anything
 * reaches the board.
 */

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

const flowSchema = z.object({
  name: z.string().describe('Short name for the flow, e.g. "UCSF front desk"'),
  persona: z.string(),
  rules: z.string().describe('One rule per line'),
  globalExits: z.array(exitSchema),
  globalCues: z.array(cueSchema),
  stages: z.array(
    z.object({
      code: z.string(),
      name: z.string().describe('UPPER CASE, a few words'),
      goal: z.string(),
      collect: z.array(z.object({ name: z.string(), description: z.string(), required: z.boolean() })),
      instructions: z.string(),
      steering: z.enum(['strict', 'balanced', 'relaxed']),
      exits: z.array(exitSchema),
      cues: z.array(cueSchema),
    }),
  ),
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

function toFlow(g: Generated): AgentFlow {
  const upper = (s: string) => s.trim().toUpperCase();
  return {
    name: g.name.trim(),
    persona: g.persona.trim(),
    rules: g.rules.trim(),
    globalExits: g.globalExits.map((e) => ({ ...e, to: upper(e.to), onComplete: false })),
    globalCues: g.globalCues,
    tdUrl: '',
    stages: g.stages.map((s, i) => ({
      ...s,
      id: `gen-${i}-${upper(s.code)}`,
      code: upper(s.code),
      exits: s.exits.map((e) => ({
        ...e,
        to: upper(e.to) === 'END' ? END : upper(e.to),
        when: e.onComplete ? e.when.trim().replace(/^(?:the\s+)?goal(?:\s+is)?\s+met\b[\s—–:,.-]*/i, '') : e.when.trim(),
      })),
    })),
  };
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
  });
  let flow = toFlow(first.output);
  let problems = validateFlow(flow);

  if (problems.length > 0) {
    const second = await generateText({
      model,
      system: SYSTEM,
      prompt:
        `BRIEF FROM THE STUDENT:\n${brief.trim()}${context}\n\nYOUR PREVIOUS DESIGN:\n${JSON.stringify(first.output)}\n\n` +
        `IT HAS THESE PROBLEMS — return the corrected full design:\n${problems.map((p) => `- ${p}`).join('\n')}`,
      output: Output.object({ schema: flowSchema }),
      maxOutputTokens: 8000,
    });
    const fixed = toFlow(second.output);
    const fixedProblems = validateFlow(fixed);
    if (fixedProblems.length < problems.length) {
      flow = fixed;
      problems = fixedProblems;
    }
  }
  return { flow, problems };
}
