import { anthropic, isAnthropicConfigured, MODELS } from "./anthropic";

/**
 * Rosewood Rhythm prompt library.
 *
 * Every prompt enforces ONE invariant: outputs use hospitality language only.
 * No HRV, no recovery score, no sleep score, no "stress," no medical verbs.
 * Translate to: energy, pacing, softer/fuller morning, restoration, presence.
 */

// ---------------------------------------------------------------------------
// Shared guardrails — pasted into every system prompt.
// ---------------------------------------------------------------------------

const HOUSE_RULES = `
You are Rose, Rosewood's AI concierge — present inside the staff group chat
and in soft texts and calls with the guest. Your single job is to translate
sensitive guest signals (sleep, travel strain, stated preferences, cycle
comfort) into discreet hospitality choreography.

ABSOLUTE RULES — violation breaks the product:
1. NEVER name a metric. Forbidden words: HRV, recovery score, sleep score,
   resting heart rate, RHR, biometrics, health data, stress level,
   recovery state, strain score, oxygen saturation, calories, REM, deep sleep.
2. Translate ALL signals into hospitality language: energy, pacing, fuller
   morning, softer morning, presence, restoration, comfort, ease, anchoring.
3. NEVER mention period cycles, menstrual data, or fertility. If the
   intake flagged "comfort_mode_warm," surface only as "warmer room,
   gentler pacing today." No further detail.
4. Stay in Rosewood's "A Sense of Place" voice. Anchor recommendations to
   the property's local culture, not generic luxury.
5. Tone: warm, restrained, observational. Never urgent, never effusive.
   Short sentences. Lower-case ok in casual chat. No emoji unless it is a
   subtle hospitality glyph in a card label.
6. Write as a colleague in the group chat, not a chatbot. Use the staff's
   names when given. Sign off only on rich cards, not chat lines.
7. When uncertain, propose, do not act. Mark proposals "pending" so a
   human approves before the guest sees anything.
`.trim();

// ---------------------------------------------------------------------------
// Types — these are the structured contracts the UI renders against.
// ---------------------------------------------------------------------------

export interface IntakeAnswers {
  arrivalVibe: "restorative" | "social" | "productive" | "celebratory" | "exploratory";
  pacing: "slow" | "balanced" | "full";
  avoid: string[];
  foodPreferences: string[];
  scent: string | null;
  contactPreference: "sms" | "voice" | "either";
  wakeWindow: string | null;
  eveningWindow: string | null;
  occasion: string | null;
  comfortFlags: string[];
  summary: string;
}

export interface ArrivalBrief {
  guestState: string; // one elegant sentence, hospitality language only
  serviceMode: "low_touch" | "balanced" | "warm_attentive";
  roomPrep: {
    temperatureF: number;
    lighting: string;
    scent: string;
    amenities: string[]; // each tagged to "Sense of Place"
    soundtrack: string;
    avoidInRoom: string[];
  };
  firstOffer: {
    line: string; // what the front desk says
    options: string[]; // 1–2 alternates
  };
  staffDo: string[]; // 3–5 verbs in hospitality language
  staffDoNot: string[]; // 2–4 things to avoid
  delightMomentIdea: string | null; // optional bespoke gesture
  senseOfPlaceLine: string; // one line tying this guest's intent to the property
}

export interface DailyRhythm {
  morningLine: string; // what gets texted to the guest
  morningSubject: "softer" | "balanced" | "fuller";
  schedule: Array<{
    timeLabel: string; // "8:30am", "midday", "afternoon", "evening"
    suggestion: string;
    optional: boolean;
  }>;
  staffNote: string; // one paragraph for the group thread
  approvalRequired: boolean;
}

export interface MemoryFactDraft {
  fact: string;
  kind: "preference" | "pattern" | "avoid" | "occasion" | "place_affinity";
  confidence: number;
}

// ---------------------------------------------------------------------------
// 1. Interpret intake conversation/email into structured answers.
// ---------------------------------------------------------------------------

const INTERPRET_PROMPT = `
You are extracting structured intake from a guest's pre-arrival reply.
Input is either a 7-day email reply or a transcript of a 1-day-before call.

Return ONE JSON object with this exact shape (no prose, no markdown fences):

{
  "arrivalVibe": "restorative" | "social" | "productive" | "celebratory" | "exploratory",
  "pacing": "slow" | "balanced" | "full",
  "avoid": string[],
  "foodPreferences": string[],
  "scent": string | null,
  "contactPreference": "sms" | "voice" | "either",
  "wakeWindow": string | null,
  "eveningWindow": string | null,
  "occasion": string | null,
  "comfortFlags": string[],
  "summary": string
}

Rules:
- "summary" is ONE sentence in hospitality language describing how this guest
  is arriving and what they need. Never metrics. Never medical.
- "comfortFlags" can include: "warmer_room", "softer_pacing", "quiet_first_night",
  "late_breakfast", "no_morning_calls". NEVER include cycle terms.
- Be conservative on confidence. If unsure of a field, set it to null or [].
`.trim();

export async function interpretIntake(transcript: string): Promise<IntakeAnswers> {
  if (!isAnthropicConfigured()) {
    return fallbackIntake();
  }

  const response = await anthropic.messages.create({
    model: MODELS.fast,
    max_tokens: 800,
    system: `${HOUSE_RULES}\n\n${INTERPRET_PROMPT}`,
    messages: [{ role: "user", content: `Guest reply:\n\n${transcript}` }],
  });

  return parseJson<IntakeAnswers>(response, fallbackIntake());
}

// ---------------------------------------------------------------------------
// 2. The arrival brief — the demo's WOW moment.
// ---------------------------------------------------------------------------

const BRIEF_PROMPT = `
You are drafting the arrival brief that will post in the staff group chat
30 minutes before the guest checks in.

You receive:
- guest name, photo, occasion, mergedProfileCount
- the property's sense_of_place dictionary
- the intake answers
- a hospitality-translated signal summary (NEVER raw metrics — these were
  already pre-translated for you; do not invent numbers)
- any memory facts from prior stays at other Rosewood properties

Return ONE JSON object with this exact shape (no prose, no markdown fences):

{
  "guestState": string,             // ONE sentence; hospitality language
  "serviceMode": "low_touch" | "balanced" | "warm_attentive",
  "roomPrep": {
    "temperatureF": number,         // 65–72
    "lighting": string,             // e.g., "warm low, blackout ready"
    "scent": string,                // from sense_of_place options when possible
    "amenities": string[],          // 2–4 items, each anchored to this property
    "soundtrack": string,
    "avoidInRoom": string[]         // 1–3 things NOT to do/place
  },
  "firstOffer": {
    "line": string,                 // what front desk literally says
    "options": string[]             // 1–2 alternates
  },
  "staffDo": string[],              // 3–5 short directives
  "staffDoNot": string[],           // 2–4 short prohibitions
  "delightMomentIdea": string | null,
  "senseOfPlaceLine": string        // one line tying intent ↔ this property
}

Voice rules:
- Every line should sound like a thoughtful Rosewood concierge wrote it.
- "staffDo" uses verbs: "offer," "draw," "hold," "anchor."
- "staffDoNot" never mentions sensitive data. Say "do not push spa tonight"
  not "do not mention recovery score."
- "amenities" must reference the property's signature items where natural.
- If occasion is set (e.g., "anniversary"), the delightMomentIdea is real.
`.trim();

interface BriefInput {
  guest: {
    name: string;
    occasion: string | null;
    mergedProfileCount: number;
    contactPreference: string;
  };
  property: {
    name: string;
    city: string;
    senseOfPlace: Record<string, unknown>;
  };
  intake: IntakeAnswers;
  signalSummary: string; // pre-translated, no metrics
  memoryFacts: Array<{ fact: string; kind: string }>;
}

export async function generateArrivalBrief(
  input: BriefInput,
): Promise<ArrivalBrief> {
  if (!isAnthropicConfigured()) {
    return fallbackBrief(input);
  }

  const userMessage = `
GUEST
${JSON.stringify(input.guest, null, 2)}

PROPERTY (this is "${input.property.name}" — anchor to its sense of place)
${JSON.stringify(input.property, null, 2)}

INTAKE
${JSON.stringify(input.intake, null, 2)}

PRE-TRANSLATED SIGNAL SUMMARY (already in hospitality language; do not invent metrics)
${input.signalSummary}

MEMORY FROM PRIOR ROSEWOOD STAYS
${input.memoryFacts.length === 0 ? "(first Rosewood stay)" : JSON.stringify(input.memoryFacts, null, 2)}

Draft the arrival brief now. JSON only.
`.trim();

  const response = await anthropic.messages.create({
    model: MODELS.thinker,
    max_tokens: 1200,
    system: `${HOUSE_RULES}\n\n${BRIEF_PROMPT}`,
    messages: [{ role: "user", content: userMessage }],
  });

  return parseJson<ArrivalBrief>(response, fallbackBrief(input));
}

// ---------------------------------------------------------------------------
// 3. Daily rhythm — morning re-plan based on overnight signals.
// ---------------------------------------------------------------------------

const DAILY_PROMPT = `
You are drafting the daily rhythm that posts in the staff thread at 6:30am
and (with staff approval) goes to the guest as a soft text.

You receive: yesterday's brief, today's pre-translated signal summary
(NEVER raw metrics), and any guest replies overnight.

Return ONE JSON object (no prose):

{
  "morningLine": string,            // exactly what the guest reads in SMS
  "morningSubject": "softer" | "balanced" | "fuller",
  "schedule": [
    { "timeLabel": string, "suggestion": string, "optional": boolean }
  ],
  "staffNote": string,              // one paragraph; visible only to staff
  "approvalRequired": boolean
}

Voice rules:
- morningLine: warm, lower-case ok, no greeting beyond a soft "Good morning."
  Frame in terms of pacing not data. Example:
  "Good morning. Since yesterday was a long arrival, we held breakfast for 9:30
   and a quiet garden walk before. No need to confirm — just come when you're ready."
- schedule has 3–5 items. Mark anything optional as optional: true.
- "approvalRequired" is true unless this is purely automated (room temp).
`.trim();

interface DailyInput {
  property: { name: string; city: string };
  brief: ArrivalBrief;
  signalSummary: string;
  contactPreference: string;
}

export async function generateDailyRhythm(
  input: DailyInput,
): Promise<DailyRhythm> {
  if (!isAnthropicConfigured()) {
    return fallbackDaily(input);
  }

  const userMessage = `
PROPERTY: ${input.property.name}, ${input.property.city}
CONTACT PREFERENCE: ${input.contactPreference}

YESTERDAY'S BRIEF
${JSON.stringify(input.brief, null, 2)}

TODAY'S PRE-TRANSLATED SIGNAL SUMMARY
${input.signalSummary}

Draft the rhythm. JSON only.
`.trim();

  const response = await anthropic.messages.create({
    model: MODELS.fast,
    max_tokens: 700,
    system: `${HOUSE_RULES}\n\n${DAILY_PROMPT}`,
    messages: [{ role: "user", content: userMessage }],
  });

  return parseJson<DailyRhythm>(response, fallbackDaily(input));
}

// ---------------------------------------------------------------------------
// 4. Extract durable memory from the post-stay call.
// ---------------------------------------------------------------------------

const MEMORY_PROMPT = `
You are reading a post-stay call transcript and extracting durable facts
that will improve the guest's NEXT stay at any Rosewood property.

Return a JSON array (no prose):

[
  { "fact": string, "kind": "preference" | "pattern" | "avoid" | "occasion" | "place_affinity", "confidence": number }
]

Rules:
- Each fact is ONE short hospitality-language sentence the next property
  could act on. "Prefers late breakfast after long travel." not
  "Sleep performance was 68%."
- 4–8 facts total. Skip generic facts ("liked the room").
- "place_affinity" is for things tied to a specific Rosewood location
  ("loves the oak grove walk at Sand Hill").
- confidence: 0.6–0.95. Higher when the guest stated it directly.
`.trim();

export async function extractMemory(
  transcript: string,
  context: { propertyName: string; stayDates: string },
): Promise<MemoryFactDraft[]> {
  if (!isAnthropicConfigured()) {
    return fallbackMemory();
  }

  const response = await anthropic.messages.create({
    model: MODELS.fast,
    max_tokens: 700,
    system: `${HOUSE_RULES}\n\n${MEMORY_PROMPT}`,
    messages: [
      {
        role: "user",
        content: `Stay: ${context.propertyName} (${context.stayDates})\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  return parseJson<MemoryFactDraft[]>(response, fallbackMemory());
}

// ---------------------------------------------------------------------------
// Parsing + fallback content. The demo MUST never go blank.
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicMessageResponse {
  content: Array<{ type: string } & Partial<AnthropicTextBlock>>;
}

function parseJson<T>(
  response: Awaited<ReturnType<typeof anthropic.messages.create>>,
  fallback: T,
): T {
  // We never pass stream: true, so response is always a Message — narrow it.
  const message = response as unknown as AnthropicMessageResponse;
  const block = message.content.find((c) => c.type === "text");
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    return fallback;
  }
  const text = block.text.trim();
  // Strip ```json fences if Claude added them despite instructions.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("[rhythm] JSON parse failed, using fallback", err, text);
    return fallback;
  }
}

function fallbackIntake(): IntakeAnswers {
  return {
    arrivalVibe: "restorative",
    pacing: "slow",
    avoid: ["loud music", "early morning calls"],
    foodPreferences: ["light vegetarian", "herbal tea"],
    scent: "cedar & wildflower",
    contactPreference: "sms",
    wakeWindow: "8:30–10:00",
    eveningWindow: "after 6pm",
    occasion: "board meeting Friday",
    comfortFlags: ["softer_pacing", "quiet_first_night", "late_breakfast"],
    summary: "Arriving from a long flight; wants a quiet first evening and a slow, restorative pacing before a high-stakes meeting.",
  };
}

function fallbackBrief(input: BriefInput): ArrivalBrief {
  const propertyName = input.property.name;
  return {
    guestState: `Arriving from a red-eye and wants to feel human again before Friday — receive her softly.`,
    serviceMode: "low_touch",
    roomPrep: {
      temperatureF: 67,
      lighting: "warm low, blackout drawn",
      scent: "cedar & wildflower",
      amenities: [
        `${propertyName}'s valley honey & chamomile`,
        "Magnesium tea service at turndown",
        "Eucalyptus shower bundle",
      ],
      soundtrack: "soft acoustic, low volume",
      avoidInRoom: ["champagne welcome", "loud floral spray"],
    },
    firstOffer: {
      line: "Welcome back. We held a quiet table at the garden, or we can send something light to your room — whichever helps.",
      options: ["Garden table, 7pm", "Light room service, any time"],
    },
    staffDo: [
      "Keep check-in concise — no amenity tour tonight",
      "Offer the room option first, dining as a soft alternate",
      "Draw the blinds and dim the room before key-card hand-off",
      "Hold the morning newspaper unless she asks",
    ],
    staffDoNot: [
      "Do not push the spa or wine tasting tonight",
      "Do not mention sleep, recovery, or any wellness terminology",
      "Do not schedule an early breakfast",
    ],
    delightMomentIdea: "A small note in her handwriting-style font: 'A slower morning is held for you.'",
    senseOfPlaceLine: `${propertyName} as restoration: the oak grove walk and the still water of the garden, on her pace.`,
  };
}

function fallbackDaily(input: DailyInput): DailyRhythm {
  return {
    morningLine:
      "Good morning. Since yesterday was a long arrival, we held breakfast for 9:30 and the garden walk before that — no need to confirm, come when you're ready.",
    morningSubject: "softer",
    schedule: [
      { timeLabel: "9:30am", suggestion: "Breakfast in the garden, your pace", optional: false },
      { timeLabel: "11:00am", suggestion: "Oak grove walk (15 min loop)", optional: true },
      { timeLabel: "3:00pm", suggestion: "Asaya recovery treatment", optional: true },
      { timeLabel: "evening", suggestion: "Light tasting menu held in the conservatory", optional: false },
    ],
    staffNote: `Hold morning until 9:30 — confirmed by Maya last night. Recommend Asaya recovery rather than the trail hike originally booked; she has a board dinner tomorrow. Wine tasting moved to Saturday.`,
    approvalRequired: true,
  };
}

function fallbackMemory(): MemoryFactDraft[] {
  return [
    { fact: "Prefers a quiet first evening after long travel.", kind: "preference", confidence: 0.92 },
    { fact: "Late breakfast (after 9am) on travel-recovery mornings.", kind: "pattern", confidence: 0.9 },
    { fact: "Responds well to low-touch check-in; no amenity tour.", kind: "preference", confidence: 0.88 },
    { fact: "Loves the oak grove walk at Sand Hill.", kind: "place_affinity", confidence: 0.85 },
    { fact: "Avoid early morning calls or knocks unless invited.", kind: "avoid", confidence: 0.93 },
    { fact: "Cedar & wildflower scent preferred over floral.", kind: "preference", confidence: 0.8 },
  ];
}

/**
 * Pre-translates raw signal payloads into hospitality language so the
 * brief/daily prompts never see numbers. This is where the firewall sits.
 */
export function translateSignalsToHospitality(payload: {
  sleepMinutes?: number;
  sleepQuality?: string;
  travelStrain?: string;
  recoveryBand?: string;
  cycleComfortMode?: boolean;
}): string {
  const parts: string[] = [];
  if (payload.sleepMinutes !== undefined) {
    if (payload.sleepMinutes < 360) parts.push("short rest overnight");
    else if (payload.sleepMinutes < 420) parts.push("partial rest overnight");
    else parts.push("a fuller rest overnight");
  }
  if (payload.travelStrain === "high") parts.push("arriving with significant travel weight");
  if (payload.recoveryBand === "low") parts.push("energy is on the lower side today");
  if (payload.recoveryBand === "mid") parts.push("energy is steady");
  if (payload.recoveryBand === "high") parts.push("energy is open to a fuller day");
  if (payload.cycleComfortMode) parts.push("comfort mode requested (warmer room, gentler pacing)");
  if (parts.length === 0) return "no notable signals today; default to balanced pacing.";
  return parts.join("; ") + ".";
}
