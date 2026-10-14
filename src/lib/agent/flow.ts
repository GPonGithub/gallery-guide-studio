import { END, type AgentFlow, type SessionState, type Stage } from './types';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// Same ordering rule as the step-table version (src/lib/startBox.ts): "1"
// before "2A" before "2B" before "3A"; codes that don't parse sort last.
function parseCode(code: string): [number, string] | null {
  const match = /^(\d+)([A-Za-z]*)$/.exec(code.trim());
  return match ? [Number(match[1]), match[2].toUpperCase()] : null;
}

export function sortStages(stages: Stage[]): Stage[] {
  return [...stages].sort((a, b) => {
    const ca = parseCode(a.code);
    const cb = parseCode(b.code);
    if (!ca || !cb) return ca ? -1 : cb ? 1 : 0;
    return ca[0] - cb[0] || ca[1].localeCompare(cb[1]);
  });
}

/** RULE: conversations start at the lowest stage code. */
export function startStage(flow: AgentFlow): Stage | null {
  return sortStages(flow.stages)[0] ?? null;
}

export function findStage(flow: AgentFlow, code: string): Stage | undefined {
  return flow.stages.find((s) => s.code === code);
}

export function initialState(flow: AgentFlow, stageCode?: string): SessionState {
  return {
    sessionId: newId(),
    stageCode: stageCode ?? startStage(flow)?.code ?? '',
    slots: {},
    turnsInStage: 0,
    offTopicStreak: 0,
    completedStages: [],
    ended: false,
  };
}

export function blankStage(code: string): Stage {
  return {
    id: newId(),
    code,
    name: 'NEW STAGE',
    goal: '',
    collect: [],
    instructions: '',
    steering: 'balanced',
    exits: [],
    cues: [],
  };
}

export const emptyFlow: AgentFlow = {
  name: '',
  persona: '',
  rules: '',
  globalExits: [],
  globalCues: [],
  stages: [],
  tdUrl: '',
};

/**
 * The UCSF front-desk flow from the FigJam board, rewritten as goals
 * instead of step tables — a working example to test and edit.
 */
export function sampleFlow(): AgentFlow {
  return {
    name: 'UCSF front desk',
    persona:
      'You are the automated front-desk assistant for UCSF. Warm, professional and efficient — like a good ' +
      'receptionist, not a chatbot.',
    rules: [
      'This is a voice conversation: say only what is needed, never more than a sentence or two at a time.',
      'Ask one question at a time and wait for the answer.',
      'Never accept a vague answer for something that needs a specific value (a date, time or name). Offer 2–3 ' +
        'concrete options and ask again.',
      'Never give medical advice.',
      'Never mention that you are an AI, a prototype or a system being tested.',
      'If the caller asks for something you cannot help with, say so plainly and offer to have someone call them back.',
    ].join('\n'),
    globalExits: [
      { to: '2A', when: 'the caller says or implies this is a medical emergency, at any point', onComplete: false },
    ],
    globalCues: [],
    tdUrl: '',
    stages: [
      {
        id: newId(),
        code: '1',
        name: 'WELCOME',
        goal: 'Welcome the caller to UCSF and find out whether this is a medical emergency.',
        collect: [{ name: 'is_emergency', description: 'whether this is a medical emergency (yes or no)', required: true }],
        instructions: 'Greet the caller, then ask whether this is a medical emergency before anything else.',
        steering: 'strict',
        exits: [
          { to: '2B', when: 'it is not an emergency', onComplete: true },
        ],
        cues: [{ name: 'WELCOME_VIDEO', on: 'enter' }],
      },
      {
        id: newId(),
        code: '2A',
        name: 'EMERGENCY',
        goal: 'Make sure the caller knows to hang up and dial 911 right away.',
        collect: [],
        instructions:
          'Explain calmly that this line cannot help with emergencies, and tell them to hang up and dial 911 now. ' +
          'Be brief and clear.',
        steering: 'strict',
        exits: [{ to: END, when: 'the caller has been told to dial 911', onComplete: true }],
        cues: [{ name: 'EMERGENCY_ALERT', on: 'enter' }],
      },
      {
        id: newId(),
        code: '2B',
        name: 'OFFER SERVICES',
        goal: "Learn the caller's name and which service they need.",
        collect: [
          { name: 'patient_name', description: "the caller's full name", required: true },
          {
            name: 'service',
            description: 'which service they need: make an appointment, renew a prescription, or pay a bill',
            required: true,
          },
        ],
        instructions:
          'Ask for their full name and thank them using their first name. Then offer the three services: making ' +
          'an appointment, renewing a prescription, or paying a bill.',
        steering: 'balanced',
        exits: [
          { to: '3A', when: 'the caller wants to make an appointment', onComplete: false },
          { to: '3B', when: 'the caller wants to renew a prescription', onComplete: false },
          { to: '3C', when: 'the caller wants to pay a bill', onComplete: false },
        ],
        cues: [{ name: 'NAME_CAPTURED', on: 'slot', slot: 'patient_name' }],
      },
      {
        id: newId(),
        code: '3A',
        name: 'MAKE AN APPOINTMENT',
        goal: 'Book an appointment the caller has confirmed.',
        collect: [
          { name: 'provider_type', description: 'whether they want a doctor or a specialist', required: true },
          { name: 'doctor_name', description: "the doctor's name, if they want a doctor", required: false },
          { name: 'specialist_type', description: 'the kind of specialist, if they want a specialist', required: false },
          { name: 'appointment_day', description: 'the specific day they want', required: true },
          { name: 'appointment_time', description: 'the specific time they want', required: true },
          { name: 'appointment_confirmed', description: 'whether they confirmed the day and time (yes or no)', required: true },
        ],
        instructions:
          'Ask whether they want a doctor or a specialist, then the doctor\'s name or the kind of specialist. Then ' +
          'the day, then the time. Read the day and time back and ask them to confirm.',
        steering: 'balanced',
        exits: [
          { to: END, when: 'the appointment is confirmed — thank them and say goodbye', onComplete: true },
          { to: '3B', when: 'the caller also wants to renew a prescription', onComplete: false },
        ],
        cues: [
          { name: 'APPOINTMENT_VIDEO', on: 'enter' },
          { name: 'CALENDAR_FLASH', on: 'slot', slot: 'appointment_day' },
          { name: 'CONFIRMED_LIGHTS', on: 'complete' },
        ],
      },
      {
        id: newId(),
        code: '3B',
        name: 'PRESCRIPTION RENEWAL',
        goal: 'Renew the prescription the caller needs.',
        collect: [
          {
            name: 'prescription',
            description: 'which prescription to refill: Zoloft, BuSpar or Propranolol',
            required: true,
          },
        ],
        instructions:
          "Say you've found their prescriptions — Zoloft, BuSpar and Propranolol — and ask which needs refilling. " +
          'Then confirm it has been renewed and will be ready at their pharmacy on record.',
        steering: 'balanced',
        exits: [{ to: END, when: 'the prescription has been renewed — say goodbye politely', onComplete: true }],
        cues: [{ name: 'PRESCRIPTION_VIDEO', on: 'enter' }],
      },
      {
        id: newId(),
        code: '3C',
        name: 'PAY A BILL',
        goal: 'Settle the caller\'s $300 bill.',
        collect: [
          {
            name: 'card_last_four',
            description: 'the last four digits of the card they will pay with (this is a prototype — never ask for a full card number)',
            required: true,
          },
        ],
        instructions:
          'Tell them you have found a bill for $300. Ask for the last four digits of the card they want to use. ' +
          'Then say the bill is settled, thank them, and ask if there is anything else.',
        steering: 'balanced',
        exits: [
          { to: '3A', when: 'the caller now wants to make an appointment', onComplete: false },
          { to: '3B', when: 'the caller now wants to renew a prescription', onComplete: false },
          { to: END, when: 'the bill is paid and they need nothing else', onComplete: true },
        ],
        cues: [{ name: 'PAYMENT_DONE', on: 'complete' }, { name: 'PRICE_MENTIONED', on: 'moment', when: 'the agent tells the caller the bill amount' }],
      },
    ],
  };
}
