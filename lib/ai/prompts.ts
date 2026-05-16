import { anthropic, isAnthropicConfigured, MODELS } from "./anthropic";
import type { WhoopSnapshot } from "@/lib/whoop/snapshot";

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

export interface FlightInfo {
  number: string | null;        // e.g., "AA 8"
  origin: string | null;        // "JFK"
  destination: string | null;   // "SFO"
  arrivalTime: string | null;   // "Thu 7:42am PT"
  notes: string | null;         // "red-eye, light delays expected"
}

export interface Companion {
  name: string;          // "Alex"
  relationship: string;  // "partner", "spouse", "colleague", "friend"
  note: string | null;   // "anniversary Saturday"
}

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
  comfortFlags: string[];           // includes "cycle_comfort" when opted in
  experiencesRequested: string[];   // e.g., ["asaya recovery", "oak grove walk"]
  flight: FlightInfo | null;
  companion: Companion | null;      // who they're traveling with, if anyone
  summary: string;
}

export interface ArrivalBrief {
  guestState: string; // one elegant sentence, hospitality language only
  serviceMode: "low_touch" | "balanced" | "warm_attentive";
  flight: FlightInfo | null;             // pulled forward from intake, shown prominently
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
  experiencesToPrep: Array<{
    experience: string;       // "Asaya recovery treatment"
    when: string;             // "Friday afternoon"
    prepNote: string;         // "book 4pm, request the quiet room"
  }>;
  staffDo: string[]; // 3–5 verbs in hospitality language
  staffDoNot: string[]; // 2–4 things to avoid
  comfortLine: string | null;            // one gentle line if comfort flags set
  delightMomentIdea: string | null;      // optional bespoke gesture
  senseOfPlaceLine: string;              // one line tying this guest's intent to the property
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
  "experiencesRequested": string[],
  "flight": { "number": string|null, "origin": string|null, "destination": string|null, "arrivalTime": string|null, "notes": string|null } | null,
  "companion": { "name": string, "relationship": string, "note": string|null } | null,
  "summary": string
}

Rules:
- "summary" is ONE sentence in hospitality language describing how this guest
  is arriving and what they need. Never metrics. Never medical.
- "comfortFlags" can include: "warmer_room", "softer_pacing", "quiet_first_night",
  "late_breakfast", "no_morning_calls", "cycle_comfort". Never any specific
  cycle terminology beyond the flag. If cycle_comfort is set, the brief will
  surface only "warmer room, gentler pacing" — never the underlying detail.
- "experiencesRequested" — things the guest mentioned wanting (Asaya, walks,
  dining, golf, wine, etc). Up to 6 items, each as a short phrase.
- "flight" — if a flight number is given, fill what you can; null otherwise.
- Be conservative. Unknown fields → null or [].
`.trim();

export async function interpretIntake(transcript: string): Promise<IntakeAnswers> {
  if (!isAnthropicConfigured()) {
    return fallbackIntake(transcript);
  }

  const response = await anthropic.messages.create({
    model: MODELS.fast,
    max_tokens: 800,
    system: `${HOUSE_RULES}\n\n${INTERPRET_PROMPT}`,
    messages: [{ role: "user", content: `Guest reply:\n\n${transcript}` }],
  });

  return parseJson<IntakeAnswers>(response, fallbackIntake(transcript));
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
  "flight": { "number": string|null, "origin": string|null, "destination": string|null, "arrivalTime": string|null, "notes": string|null } | null,
  "roomPrep": {
    "temperatureF": number,         // 65–72 (a degree or two warmer if comfort_flag set)
    "lighting": string,
    "scent": string,
    "amenities": string[],
    "soundtrack": string,
    "avoidInRoom": string[]
  },
  "firstOffer": {
    "line": string,
    "options": string[]
  },
  "experiencesToPrep": [
    { "experience": string, "when": string, "prepNote": string }
  ],
  "staffDo": string[],
  "staffDoNot": string[],
  "comfortLine": string | null,
  "delightMomentIdea": string | null,
  "senseOfPlaceLine": string
}

Voice rules:
- Every line should sound like a thoughtful Rosewood concierge wrote it.
- "staffDo" uses verbs: "offer," "draw," "hold," "anchor."
- "staffDoNot" never mentions sensitive data. Say "do not push spa tonight"
  not "do not mention recovery score."
- "amenities" must reference the property's signature items where natural.
- "flight" — pull forward from intake unchanged; null if unknown.
- "experiencesToPrep" — map intake.experiencesRequested into actionable cards
  with when + prepNote (which department prepares what). Move conflicting
  experiences to a different day if needed and say so in prepNote.
- "comfortLine" — if intake.comfortFlags includes "cycle_comfort", emit ONE
  sentence ONLY: "warmer room, gentler pacing today/tomorrow." NEVER any
  cycle terminology. Null otherwise. Never expose the underlying flag's name.
- If occasion is set (e.g., "anniversary"), the delightMomentIdea is real.

Snapshot-aware tuning (use the SIGNAL SUMMARY to drive these choices):
- If the summary mentions a recent workout / effort:
  - Include a refuel-style amenity in roomPrep.amenities — protein-forward
    light bite, electrolytes, fresh fruit, salted nuts — anchored to the
    property's larder where natural.
  - Stock a clean workout towel + the property's signature bath product
    near the shower.
  - Add a "first 20 minutes of quiet to refuel and shower" beat to staffDo
    when intensity sounds full.
  - serviceMode tilts toward "warm_attentive" if the effort was full and
    energy is on the lower side; "balanced" if effort was moderate.
- If the summary mentions a fuller rest overnight AND energy is open to a
  fuller day, serviceMode may be "balanced" with optional fuller offers.
- If the summary mentions short rest and lower energy, serviceMode is
  "low_touch" — quieter check-in, room option first.
- "firstOffer" should reflect the snapshot. After a full effort: lead with
  a quick refuel + a hot shower; after short rest: lead with the room and
  a light dinner. Never name the effort or the metric.
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

function fallbackIntake(transcript?: string): IntakeAnswers {
  // Without Claude, we can't produce structured fields, but we can at least
  // try a tiny amount of keyword extraction so what the guest actually said
  // (e.g. "chocolate cake") doesn't disappear from foodPreferences.
  const guestLines = (transcript ?? "")
    .split(/\n+/)
    .filter((l) => !/^rose:/i.test(l) && !/^[\s_]*$/.test(l));
  const guestText = guestLines
    .map((l) => l.replace(/^[A-Za-z]+:\s*/, "").trim())
    .filter(Boolean)
    .join(" ");

  const FOOD_KEYWORDS = [
    "chocolate cake",
    "champagne",
    "tea",
    "coffee",
    "wine",
    "bread",
    "fruit",
    "cheese",
    "vegan",
    "vegetarian",
    "gluten-free",
    "dairy-free",
    "salad",
    "soup",
    "smoothie",
    "snack",
    "protein",
    "electrolytes",
    "water",
    "ice",
  ];
  const detectedFoods = FOOD_KEYWORDS.filter((k) =>
    guestText.toLowerCase().includes(k),
  );

  const foodPreferences =
    detectedFoods.length > 0
      ? detectedFoods
      : ["light vegetarian", "herbal tea"];

  // Synthesize a one-line summary from the guest's first substantive lines
  // so the Overview shows something authentic even without Claude.
  const synthesizedSummary = guestText
    ? `Guest reply (verbatim, no AI interpretation): "${truncate(guestText, 240)}"`
    : "Arriving solo for a slow first evening; lavender-scented room, late breakfast, no early morning calls.";

  return {
    arrivalVibe: "restorative",
    pacing: "slow",
    avoid: ["loud music", "early morning calls"],
    foodPreferences,
    scent: "lavender",
    contactPreference: "sms",
    wakeWindow: "8:30–10:00",
    eveningWindow: "after 6pm",
    occasion: null,
    comfortFlags: ["softer_pacing", "quiet_first_night"],
    experiencesRequested: [],
    flight: null,
    companion: null,
    summary: synthesizedSummary,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function fallbackBrief(input: BriefInput): ArrivalBrief {
  const propertyName = input.property.name;
  const intake = input.intake;
  const hasCycleComfort = intake.comfortFlags?.includes("cycle_comfort") ?? false;
  const foods = (intake.foodPreferences ?? []).filter(
    (f): f is string => typeof f === "string" && f.trim().length > 0,
  );
  const experiences = (intake.experiencesRequested ?? []).filter(
    (e): e is string => typeof e === "string" && e.trim().length > 0,
  );
  const guestName = input.guest.name.split(" ")[0];

  // Lead line: prefer the AI-extracted summary (which captures whatever the
  // guest said most recently — including post-call additions like "I want
  // chocolate cake"). Fall back to the canned line only if no summary
  // was produced.
  const guestState =
    intake.summary && intake.summary.trim().length > 0
      ? intake.summary
      : `Arriving for a quiet, restorative first day — receive ${guestName} softly.`;

  // Fold the guest's stated food preferences into amenities so even in
  // fallback mode the brief reflects what they asked for.
  const baseAmenities = [
    `${propertyName}'s valley honey & chamomile`,
    "Magnesium tea service at turndown",
    "Eucalyptus shower bundle",
    "Heated mattress pad — pre-warmed",
  ];
  const foodAmenities = foods
    .slice(0, 3)
    .map((f) => `${capitalizeFirst(f)} ready in-room (per the guest's request)`);

  const firstOfferLine =
    foods.length > 0
      ? `Welcome back. We have ${joinList(foods)} ready in your room — let us know if you'd like anything else with it.`
      : "Welcome back. We held a quiet table at the garden, or we can send something light to your room — whichever helps.";

  const experiencesToPrep =
    experiences.length > 0
      ? experiences.slice(0, 4).map((e) => ({
          experience: e,
          when: "during the stay",
          prepNote: "team to coordinate timing per the intake.",
        }))
      : [
          {
            experience: "Asaya recovery treatment",
            when: "Friday afternoon, 4pm",
            prepNote: "Book the quiet room; therapist has her file from prior stays.",
          },
          {
            experience: "Oak grove walk (15-min loop)",
            when: "Friday late morning",
            prepNote: "Grounds team: check the bend path is clear.",
          },
        ];

  const staffDo = [
    "Keep check-in concise — no amenity tour tonight",
    "Offer the room option first, dining as a soft alternate",
    "Draw the blinds and dim the room before key-card hand-off",
  ];
  if (foods.length > 0) {
    staffDo.push(`Have ${joinList(foods)} ready in-room before arrival`);
  }

  return {
    guestState,
    serviceMode: "low_touch",
    flight: intake.flight,
    roomPrep: {
      temperatureF: hasCycleComfort ? 69 : 67,
      lighting: "warm low, blackout drawn",
      scent: intake.scent ?? "lavender bundle on nightstand",
      amenities: [...baseAmenities, ...foodAmenities],
      soundtrack: "soft acoustic, low volume",
      avoidInRoom: ["champagne welcome", "loud floral spray"],
    },
    firstOffer: {
      line: firstOfferLine,
      options: ["Garden table, 7pm", "Light room service, any time"],
    },
    experiencesToPrep,
    staffDo,
    staffDoNot: [
      "Do not push the spa or wine tasting tonight",
      "Do not mention sleep, recovery, or any wellness terminology",
      "Do not schedule an early breakfast",
    ],
    comfortLine: hasCycleComfort
      ? "Comfort mode requested: warmer room, gentler pacing today. No further detail beyond this line."
      : null,
    delightMomentIdea:
      intake.occasion && intake.occasion.toLowerCase().includes("anniversary")
        ? "A small handwritten note from the team — quiet, no announcement."
        : null,
    senseOfPlaceLine: `${propertyName} as restoration: the property's signature walk and still water, on the guest's pace.`,
  };
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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

/**
 * Pre-translates a real Whoop snapshot (sleep + recovery + cycle + workouts)
 * into hospitality language. This is the firewall: the brief/daily prompts
 * never see numbers, sport names by themselves, or any clinical phrasing.
 *
 * Output is a small bag of named lines so the brief prompt can pick which
 * to weave in. We intentionally stay terse — Rose's voice, not a report.
 */
export function translateWhoopSnapshotToHospitality(
  snapshot: WhoopSnapshot,
  options: { cycleComfortMode?: boolean } = {},
): {
  summary: string;
  energyLine: string | null;
  sleepLine: string | null;
  workoutLine: string | null;
  refuelCue: string | null;
  comfortLine: string | null;
} {
  const parts: string[] = [];

  // Sleep last night
  let sleepLine: string | null = null;
  if (snapshot.sleep?.band === "short") {
    sleepLine = "short rest overnight; soften the morning";
    parts.push(sleepLine);
  } else if (snapshot.sleep?.band === "partial") {
    sleepLine = "partial rest overnight";
    parts.push(sleepLine);
  } else if (snapshot.sleep?.band === "fuller") {
    sleepLine = "a fuller rest overnight";
    parts.push(sleepLine);
  }

  // Recovery / energy band today
  let energyLine: string | null = null;
  if (snapshot.recovery?.band === "low") {
    energyLine = "energy is on the lower side today";
    parts.push(energyLine);
  } else if (snapshot.recovery?.band === "mid") {
    energyLine = "energy is steady";
    parts.push(energyLine);
  } else if (snapshot.recovery?.band === "high") {
    energyLine = "energy is open to a fuller day";
    parts.push(energyLine);
  } else if (snapshot.recovery?.band === "calibrating") {
    energyLine = "still settling into a baseline";
    parts.push(energyLine);
  }

  // Most recent workout in last ~24h (workout-aware hospitality)
  let workoutLine: string | null = null;
  let refuelCue: string | null = null;
  const w = snapshot.derived.recentWorkout;
  if (w) {
    const hoursAgo = w.endedHoursAgo;
    const when =
      hoursAgo <= 1
        ? "just finished"
        : hoursAgo <= 4
          ? `finished about ${hoursAgo}h ago`
          : hoursAgo <= 12
            ? "earlier today"
            : "yesterday";
    const intensity =
      w.strainBand === "very_hard"
        ? "a very full effort"
        : w.strainBand === "hard"
          ? "a full effort"
          : w.strainBand === "moderate"
            ? "a moderate effort"
            : "a light effort";
    const sport = describeSport(w.sportName);
    workoutLine = `${when} ${sport} — ${intensity}`;
    parts.push(workoutLine);

    if (snapshot.derived.workoutNeedsRefuel) {
      refuelCue =
        "after the effort: have protein, electrolytes, and a salty light snack ready in-room; warmer shower amenities welcome";
      parts.push("refueling cues are appropriate on arrival");
    } else if (intensity !== "a light effort") {
      refuelCue =
        "after the effort: hydration and a light protein-forward bite would land well in-room";
    }
  }

  // Cycle strain (full day load even without a discrete workout)
  if (!w && snapshot.derived.heavyStrainToday) {
    parts.push("a heavier day on the body overall — pace down the evening");
  }

  // Cycle comfort flag (from intake), passed through here for one-stop summary
  let comfortLine: string | null = null;
  if (options.cycleComfortMode) {
    comfortLine = "comfort mode requested (warmer room, gentler pacing)";
    parts.push(comfortLine);
  }

  const summary =
    parts.length === 0
      ? "no notable signals today; default to balanced pacing."
      : parts.join("; ") + ".";

  return { summary, energyLine, sleepLine, workoutLine, refuelCue, comfortLine };
}

function describeSport(sportName: string): string {
  // Map raw sport_name strings to soft, hospitality-friendly verbs.
  // We never expose the raw enum to the prompt or UI.
  const key = sportName.trim().toLowerCase();
  if (key.includes("run")) return "a run";
  if (key.includes("cycl") || key.includes("ride") || key.includes("bike"))
    return "a ride";
  if (key.includes("swim")) return "a swim";
  if (key.includes("yoga")) return "a yoga session";
  if (key.includes("pilates")) return "a pilates session";
  if (key.includes("hike") || key.includes("walk")) return "a long walk";
  if (key.includes("strength") || key.includes("weight") || key.includes("lift"))
    return "a strength session";
  if (key.includes("row")) return "a rowing session";
  if (key.includes("tennis")) return "a tennis match";
  if (key.includes("golf")) return "a round of golf";
  if (key.includes("ski") || key.includes("snowboard")) return "time on the mountain";
  if (key.includes("hiit") || key.includes("crossfit") || key.includes("functional"))
    return "an interval workout";
  // Generic fallback that still feels like Rose, not a tracker.
  return "a workout";
}
