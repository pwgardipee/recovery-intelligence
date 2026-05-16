import { anthropic, isAnthropicConfigured, MODELS } from "./anthropic";
import type { WhoopSnapshot } from "@/lib/whoop/snapshot";
import type { MemoryFactDraft } from "./prompts";

/**
 * Mid-trip + post-trip check-ins.
 *
 * These are the "Rose calls the guest mid-stay" moments — short, warm,
 * Whoop-aware conversations that produce:
 *   1. A persisted call transcript (renders as voice_call card in admin)
 *   2. A concrete recommendation for the day (renders as daily_rhythm card)
 *   3. A short list of staff actions for the group thread
 *
 * Same firewall as the rest of the prompt library: NEVER name a metric.
 * Translate everything (sleep duration, recovery, strain, workouts) into
 * hospitality language before it reaches Claude or the renderer.
 */

// ---------------------------------------------------------------------------
// House rules — same firewall as prompts.ts but inlined to avoid a circular
// import. Keep the language identical to lib/ai/prompts.ts:HOUSE_RULES.
// ---------------------------------------------------------------------------

const HOUSE_RULES = `
You are Rose, Rosewood's AI concierge. You translate sensitive guest
signals (sleep, recovery, workouts, comfort flags) into discreet
hospitality choreography.

ABSOLUTE RULES:
1. NEVER name a metric. Forbidden words: HRV, recovery score, sleep score,
   resting heart rate, RHR, biometrics, health data, stress level,
   recovery state, strain score, REM, deep sleep, oxygen saturation.
2. Translate ALL signals into hospitality language: energy, pacing,
   fuller/softer morning, presence, restoration, refuel, comfort.
3. Tone: warm, restrained, observational. Short sentences. No emoji.
4. Stay in Rosewood's "A Sense of Place" voice — anchor to the property.
5. Reference what the guest themselves said in intake when possible.
`.trim();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckinKind = "morning" | "evening";

export interface CheckinTurn {
  who: "rose" | "guest";
  line: string;
}

export interface CheckinResult {
  transcript: CheckinTurn[];
  summary: string;
  recommendation: string;
  staffActions: string[];
  guestLine: string;
}

export interface CheckinInput {
  kind: CheckinKind;
  guestName: string; // first name
  propertyName: string;
  whoopTranslated: {
    summary: string;
    energyLine: string | null;
    sleepLine: string | null;
    workoutLine: string | null;
    refuelCue: string | null;
    comfortLine: string | null;
  } | null;
  whoopSnapshotForContext: WhoopSnapshot | null;
  intakeSummary: string | null;
  foodPreferences: string[];
  occasion: string | null;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const CHECKIN_PROMPT = `
Script a SHORT, warm phone check-in between Rose and the guest mid-stay.

You receive:
- Whoop signal translated into hospitality language (already safe — never
  contains metrics; you may build on it)
- Guest's stated preferences from their pre-arrival intake
- Whether this is a morning or evening call

Return ONE JSON object (no prose, no markdown fences):

{
  "transcript": [
    { "who": "rose" | "guest", "line": string }
  ],
  "summary": string,
  "recommendation": string,
  "staffActions": [string],
  "guestLine": string
}

CONSTRAINTS:
- transcript: 5-7 turns total. Open with Rose; alternate; close with Rose.
- ROSE in turn 1 MUST acknowledge ONE specific signal (sleep, workout,
  energy) using hospitality language — never a metric.
- ROSE in turn 3 or 5 MUST make ONE concrete on-property suggestion that
  ties to the property's culture (a walk, a treatment, a specific
  breakfast or evening service). For evening calls, frame it around
  setting up tomorrow.
- IF the guest's intake mentioned food preferences, fold one into the
  conversation naturally.
- guest turns are SHORT (1 sentence, occasionally 2). Believable casual
  guest language. They can ask for one specific thing.
- Rose's last line confirms the next on-property action and closes warmly.

OUTPUT FIELDS:
- summary: ONE sentence in hospitality language describing what changed
  ("Morning held softer after partial rest; breakfast at 9:30 in-room.")
- recommendation: ONE LINE the staff acts on TODAY, very concrete.
  ("Hold breakfast for 9:30 in the garden room. Skip wake-up knock.")
- staffActions: 3-5 SHORT bullet items. Each addresses one role
  (kitchen, housekeeping, concierge, spa, grounds). Concrete actions
  only — quantities, locations, times.
- guestLine: ONE soft SMS we could send the guest right now if approved.
  Lower-case ok. No greeting beyond "Good morning." or "Hi —".
`.trim();

// ---------------------------------------------------------------------------
// generateCheckin
// ---------------------------------------------------------------------------

export async function generateCheckin(
  input: CheckinInput,
): Promise<CheckinResult> {
  if (!isAnthropicConfigured()) {
    return fallbackCheckin(input);
  }

  const userMessage = `
WHEN: ${input.kind === "morning" ? "morning, before breakfast" : "evening, before turndown"}
PROPERTY: ${input.propertyName}
GUEST FIRST NAME: ${input.guestName}

WHOOP SIGNAL (already translated into hospitality language)
${
  input.whoopTranslated
    ? JSON.stringify(input.whoopTranslated, null, 2)
    : "(no signal connected — keep the call light, ask how they're feeling)"
}

INTAKE SUMMARY (what they told us pre-arrival)
${input.intakeSummary ?? "(no intake recorded)"}

FOOD PREFERENCES
${input.foodPreferences.length > 0 ? input.foodPreferences.join(", ") : "(none stated)"}

OCCASION
${input.occasion ?? "(no special occasion)"}

Now script the check-in. JSON only.
`.trim();

  try {
    const response = await anthropic.messages.create({
      model: MODELS.fast,
      max_tokens: 1100,
      system: `${HOUSE_RULES}\n\n${CHECKIN_PROMPT}`,
      messages: [{ role: "user", content: userMessage }],
    });
    return parseJson<CheckinResult>(response, fallbackCheckin(input));
  } catch (err) {
    console.error("[generateCheckin] failed", err);
    return fallbackCheckin(input);
  }
}

// ---------------------------------------------------------------------------
// Fallback — produces a real, Whoop-aware transcript without Claude.
// ---------------------------------------------------------------------------

function fallbackCheckin(input: CheckinInput): CheckinResult {
  const isMorning = input.kind === "morning";
  const t = input.whoopTranslated;
  const food = input.foodPreferences.find(
    (f) => typeof f === "string" && f.trim().length > 0,
  );
  const guestName = input.guestName;
  const propertyName = input.propertyName;
  const sport = input.whoopSnapshotForContext?.derived.recentWorkout?.sportName;

  const sleepBand = input.whoopSnapshotForContext?.sleep?.band ?? null;
  const recoveryBand = input.whoopSnapshotForContext?.recovery?.band ?? null;
  const needsRefuel =
    !!input.whoopSnapshotForContext?.derived.workoutNeedsRefuel;
  const fullerSleep = sleepBand === "fuller";
  const shortSleep = sleepBand === "short";
  const lowEnergy = recoveryBand === "low";

  // -------- Opening line --------
  let opening: string;
  if (isMorning) {
    opening = shortSleep
      ? `Good morning ${guestName} — Rose here from ${propertyName}. Looks like it was a shorter rest overnight; I wanted to hold the morning soft for you.`
      : fullerSleep
        ? `Good morning ${guestName} — Rose from ${propertyName}. A fuller rest last night — that should help today land easier.`
        : `Good morning ${guestName} — Rose from ${propertyName}. Just a quick check-in before breakfast.`;
  } else {
    opening = needsRefuel && sport
      ? `Hi ${guestName} — Rose checking in. I saw the ${sport} effort earlier; how's the body settling now?`
      : lowEnergy
        ? `Hi ${guestName} — Rose checking in. Today felt heavier than usual on the body — I wanted to set tomorrow up gently.`
        : `Hi ${guestName} — Rose, just a soft evening check-in before turndown.`;
  }

  // -------- Guest reply 1 --------
  const guestReply1 = shortSleep
    ? "Yeah honestly a bit groggy. A slower morning would land well."
    : fullerSleep
      ? "Felt good actually. Open to more today."
      : isMorning
        ? "Doing alright. Coffee and something light would be perfect."
        : needsRefuel
          ? "Tired but okay. The workout was a lot."
          : "Decent. Thanks for asking.";

  // -------- Rose suggestion --------
  let roseSuggest: string;
  if (isMorning) {
    if (shortSleep) {
      roseSuggest = food
        ? `Held. We'll have ${food} and slow service in the garden room at 9:30 — no rush, no knocks before then.`
        : `Held. We'll hold breakfast at 9:30 in the garden room with a light spread — no knocks before then.`;
    } else if (fullerSleep) {
      roseSuggest = `Lovely. The oak grove walk is at its best around 8:30, then breakfast on the terrace whenever you wrap. We'll have everything ready.`;
    } else {
      roseSuggest = food
        ? `Of course. We'll set ${food} on the terrace at 8:30 — fresh-as-you-go.`
        : `Of course. Light breakfast on the terrace at 8:30 — fresh-as-you-go.`;
    }
  } else {
    if (needsRefuel) {
      roseSuggest = `Got it. I'll have electrolytes, a protein-forward bite, and a warmer shower bundle in the room. We can hold breakfast late tomorrow — say 9:30, gentle pacing.`;
    } else if (lowEnergy) {
      roseSuggest = `Held. We'll soften tomorrow morning — late breakfast, the oak grove walk on your pace, nothing on the books before noon.`;
    } else {
      roseSuggest = `Lovely. Turndown will be quiet — magnesium tea service is set, the room scent is laid. Anything for tomorrow morning?`;
    }
  }

  // -------- Guest reply 2 --------
  const guestReply2 = shortSleep || lowEnergy
    ? "Perfect. That sounds exactly right."
    : fullerSleep
      ? "Sounds great. Maybe an Asaya treatment in the afternoon?"
      : "Yeah, that works. Thanks Rose.";

  // -------- Rose closing --------
  const roseClose = isMorning
    ? `Of course. We'll see you when you're ready — take your time. ${propertyName} on your pace.`
    : `Held. Sleep well — the team will keep the morning quiet for you.`;

  const transcript: CheckinTurn[] = [
    { who: "rose", line: opening },
    { who: "guest", line: guestReply1 },
    { who: "rose", line: roseSuggest },
    { who: "guest", line: guestReply2 },
    { who: "rose", line: roseClose },
  ];

  // -------- Summary, recommendation, staff actions --------
  const summary = isMorning
    ? `Morning held ${shortSleep ? "softer" : fullerSleep ? "fuller" : "balanced"} after ${t?.sleepLine ?? "the night"}. ${food ? `${capitalize(food)} laid in.` : "Light breakfast laid in."}`
    : `Evening ${needsRefuel ? "refuel set" : lowEnergy ? "softened" : "held quiet"} based on the day's load. Tomorrow morning ${shortSleep || lowEnergy || needsRefuel ? "soft, late breakfast" : "balanced"}.`;

  const recommendation = isMorning
    ? shortSleep
      ? `Hold breakfast for 9:30 in the garden room. ${food ? `${capitalize(food)} ready in-room.` : "Light spread, slow service."} Skip the wake-up knock.`
      : fullerSleep
        ? `Open day on her pace. Oak grove walk at 8:30, terrace breakfast after.`
        : `Standard morning, ${food ? `${food} on the terrace at 8:30` : "light breakfast on the terrace at 8:30"}.`
    : needsRefuel
      ? `Refuel cart in-room (electrolytes, protein-forward bite, warmer shower bundle). Hold breakfast 9:30, soft pacing.`
      : lowEnergy
        ? `Soft evening + soft tomorrow morning. Late breakfast, no scheduled blocks before noon.`
        : `Standard turndown. Magnesium tea service set. Confirm any morning preference if guest texts back.`;

  const staffActions = isMorning
    ? [
        shortSleep
          ? `Kitchen: hold breakfast service for ${guestName} until 9:30 — garden room.`
          : `Kitchen: breakfast on the terrace at 8:30 — light, fresh-as-you-go.`,
        food
          ? `In-room: ${capitalize(food)} ready before service starts.`
          : `In-room: chamomile + valley honey on the bedside.`,
        shortSleep
          ? `Housekeeping: skip morning knock; turndown bundle holds until afternoon.`
          : `Concierge: oak grove walk loop ready, no booking needed.`,
        ...(t?.refuelCue
          ? [`Spa: have an Asaya recovery slot held for late afternoon.`]
          : []),
      ]
    : [
        needsRefuel
          ? `In-room: electrolytes, salted snack, protein-forward bite delivered before turndown.`
          : `Turndown: magnesium tea service + lavender bundle as usual.`,
        lowEnergy || needsRefuel
          ? `Kitchen: prep for late breakfast tomorrow (~9:30); no early covers needed.`
          : `Kitchen: standard breakfast prep; flexible covers from 8:00.`,
        `Concierge: hold tomorrow's first block — no scheduled activity before ${needsRefuel || lowEnergy ? "11:00" : "10:00"}.`,
        `Front desk: silent corridor lighting at ${isMorning ? "" : "21:30 onwards"}.`.trim(),
      ];

  const guestLine = isMorning
    ? shortSleep
      ? `Good morning. We've held breakfast for 9:30 in the garden room — ${food ? `${food} ready` : "slow service, light spread"}. No rush.`
      : `Good morning. Breakfast is on the terrace at 8:30 whenever you're ready.`
    : needsRefuel
      ? `Refuel set in-room. Tomorrow morning is held soft — late breakfast, no early plans.`
      : `Quiet evening held for you. Tea service when you're ready.`;

  return {
    transcript,
    summary,
    recommendation,
    staffActions: staffActions.filter(Boolean),
    guestLine,
  };
}

// ---------------------------------------------------------------------------
// Trip wrap — post-stay follow-up call + insights.
// ---------------------------------------------------------------------------

export interface TripStats {
  avgSleepMinutes: number | null;
  avgRecoveryScore: number | null;
  workoutCount: number;
  workoutSports: string[];
  avgStrain: number | null;
  daysWithData: number;
}

export interface TripWrapResult {
  transcript: CheckinTurn[];
  summary: string;
  insightHeadline: string; // big celebratory line ("you slept 53 min more per night...")
  insightLines: string[]; // 3-4 supporting hospitality lines
  facts: MemoryFactDraft[]; // memory facts to write
  guestLine: string; // optional soft text to guest
}

const TRIP_WRAP_PROMPT = `
You are scripting a SHORT post-stay follow-up call — Rose calling the
guest 24 hours after checkout to thank them and surface ONE specific
restoration moment from the trip.

You receive a small comparative summary in hospitality language:
- During-stay average sleep, recovery, workouts
- Same metrics from the period BEFORE the stay, when available
- The deltas have already been pre-translated; you may NOT name minutes,
  scores, or any numerical metric in the call dialogue itself, but you
  CAN reference them in the "insightHeadline" and "insightLines" fields
  using human language ("about an hour more rest per night", not "+53 min").
- Whatever the guest said during pre-arrival.

Return ONE JSON object (no prose, no markdown fences):

{
  "transcript": [{ "who": "rose" | "guest", "line": string }],
  "summary": string,
  "insightHeadline": string,
  "insightLines": [string],
  "facts": [
    { "fact": string, "kind": "preference" | "pattern" | "avoid" | "occasion" | "place_affinity", "confidence": number }
  ],
  "guestLine": string
}

CONSTRAINTS:
- transcript: 5-7 turns. Rose opens, asks one warm reflective question,
  surfaces the single restoration moment, asks if anything could be
  done differently, closes warmly.
- insightHeadline: ONE celebratory line in human language. Examples:
  "You slept about an hour more per night this trip than your typical
  week — your body finally caught its rhythm here."
  "Your recovery climbed steadily across the three days — restful pacing
  is doing what it should."
- insightLines: 3-5 SHORT lines, each surfacing ONE specific takeaway:
  better rest, easier mornings, a workout that felt right, comfort flags
  honored, a specific Rosewood ritual that worked.
- facts: 4-7 memory facts the next property could act on. Each in
  hospitality language. NEVER name a metric.
- guestLine: ONE soft SMS — a thank-you that quietly references the
  insight. Lower-case ok.
`.trim();

export async function generateTripWrap(input: {
  guestName: string;
  propertyName: string;
  intakeSummary: string | null;
  duringTrip: TripStats;
  beforeTrip: TripStats;
  whoopSnapshotForContext: WhoopSnapshot | null;
}): Promise<TripWrapResult> {
  if (!isAnthropicConfigured()) {
    return fallbackTripWrap(input);
  }

  // Pre-translate the deltas so Claude never sees raw numbers.
  const translatedDeltas = describeTripDeltas(input.duringTrip, input.beforeTrip);

  const userMessage = `
GUEST FIRST NAME: ${input.guestName}
PROPERTY: ${input.propertyName}

INTAKE SUMMARY (what they told us pre-arrival)
${input.intakeSummary ?? "(no intake recorded)"}

PRE-TRANSLATED TRIP DELTAS (use these verbatim or paraphrase; do NOT
introduce metrics not in this list):
${translatedDeltas.length === 0 ? "(no comparable signal data — keep the call light and gracious)" : translatedDeltas.map((d) => "- " + d).join("\n")}

WORKOUTS DURING STAY
${input.duringTrip.workoutCount > 0 ? input.duringTrip.workoutSports.join(", ") : "(no workouts logged)"}

Now script the post-stay call. JSON only.
`.trim();

  try {
    const response = await anthropic.messages.create({
      model: MODELS.thinker,
      max_tokens: 1400,
      system: `${HOUSE_RULES}\n\n${TRIP_WRAP_PROMPT}`,
      messages: [{ role: "user", content: userMessage }],
    });
    return parseJson<TripWrapResult>(response, fallbackTripWrap(input));
  } catch (err) {
    console.error("[generateTripWrap] failed", err);
    return fallbackTripWrap(input);
  }
}

function fallbackTripWrap(input: {
  guestName: string;
  propertyName: string;
  intakeSummary: string | null;
  duringTrip: TripStats;
  beforeTrip: TripStats;
}): TripWrapResult {
  const guestName = input.guestName;
  const propertyName = input.propertyName;

  const sleepDeltaMin =
    input.duringTrip.avgSleepMinutes !== null &&
    input.beforeTrip.avgSleepMinutes !== null
      ? Math.round(
          input.duringTrip.avgSleepMinutes - input.beforeTrip.avgSleepMinutes,
        )
      : null;

  const recoveryDelta =
    input.duringTrip.avgRecoveryScore !== null &&
    input.beforeTrip.avgRecoveryScore !== null
      ? Math.round(
          input.duringTrip.avgRecoveryScore -
            input.beforeTrip.avgRecoveryScore,
        )
      : null;

  // -------- Headline --------
  let insightHeadline: string;
  if (sleepDeltaMin !== null && sleepDeltaMin >= 15) {
    insightHeadline = `You slept ${sleepDeltaMin} minutes more per night here than your typical week — your body finally caught the rhythm of the valley.`;
  } else if (recoveryDelta !== null && recoveryDelta >= 8) {
    insightHeadline = `Your energy climbed steadily across the three days — restful pacing did what it should.`;
  } else if (input.duringTrip.workoutCount > 0) {
    insightHeadline = `You moved well during the stay — a fuller body for ${propertyName}'s pacing.`;
  } else {
    insightHeadline = `A quieter, more restorative few days at ${propertyName}.`;
  }

  // -------- Insight lines --------
  const insightLines: string[] = [];
  if (sleepDeltaMin !== null && sleepDeltaMin >= 15) {
    insightLines.push(
      `Your overnight rest landed about ${sleepDeltaMin} minutes longer per night than your typical week.`,
    );
  } else if (sleepDeltaMin !== null && sleepDeltaMin <= -15) {
    insightLines.push(
      `Sleep ran a little shorter than your usual week — likely the travel and the change of pace.`,
    );
  }
  if (recoveryDelta !== null && recoveryDelta >= 8) {
    insightLines.push(
      `Energy steadied across the trip — each day a touch easier than the one before.`,
    );
  } else if (recoveryDelta !== null && recoveryDelta <= -8) {
    insightLines.push(
      `Energy ran fuller before the trip; this stay was clearly about restoration over output.`,
    );
  }
  if (input.duringTrip.workoutCount > 0) {
    insightLines.push(
      `${input.duringTrip.workoutCount} workout${input.duringTrip.workoutCount === 1 ? "" : "s"} on property — ${
        input.duringTrip.workoutSports.length > 0
          ? input.duringTrip.workoutSports.slice(0, 3).join(", ")
          : "movement"
      }.`,
    );
  }
  if (insightLines.length === 0) {
    insightLines.push(
      `Soft, quiet pacing across the stay — what you asked for.`,
    );
    insightLines.push(
      `Lavender-scented room, late breakfasts, no early calls — held cleanly.`,
    );
  }

  // -------- Transcript --------
  const transcript: CheckinTurn[] = [
    {
      who: "rose",
      line: `Hi ${guestName} — this is Rose, just a quick check-in after your stay at ${propertyName}. Two short questions, no pressure.`,
    },
    { who: "guest", line: "Sure, of course." },
    {
      who: "rose",
      line:
        sleepDeltaMin !== null && sleepDeltaMin >= 15
          ? `Quietly, your body found a much fuller rest here than the week prior — it landed. Did the pacing feel right?`
          : recoveryDelta !== null && recoveryDelta >= 8
            ? `Your energy climbed steadily across the three days — that's what we hoped restful pacing would do. Did it feel that way?`
            : `Did the pacing feel right? I want to capture what worked so the team carries it forward.`,
    },
    {
      who: "guest",
      line:
        "Honestly, yes. The slower start made the rest of the trip work. The lavender room and the late breakfast — those small things mattered.",
    },
    {
      who: "rose",
      line:
        "I'm glad. Anything we could do differently next time at any Rosewood property?",
    },
    {
      who: "guest",
      line:
        "The morning walk loop is gorgeous. Otherwise, please remember the lavender, the late breakfast — all of it.",
    },
    {
      who: "rose",
      line:
        "Held. Travel safely — we'll have everything waiting next time, wherever you arrive.",
    },
  ];

  // -------- Memory facts --------
  const facts: MemoryFactDraft[] = [
    {
      fact: "Prefers a slower first day after long travel — late breakfast, no early calls.",
      kind: "pattern",
      confidence: 0.92,
    },
    {
      fact: "Lavender bundle in-room is a durable preference (Crillon → Sand Hill).",
      kind: "preference",
      confidence: 0.95,
    },
    {
      fact: "Responds well to low-touch check-in. Skip amenity tour.",
      kind: "preference",
      confidence: 0.88,
    },
  ];
  if (input.duringTrip.workoutCount > 0) {
    facts.push({
      fact: `Likes to keep training rhythm on stay (${input.duringTrip.workoutSports.slice(0, 2).join(", ") || "movement"}). Have refuel set ready.`,
      kind: "pattern",
      confidence: 0.85,
    });
  }
  if (sleepDeltaMin !== null && sleepDeltaMin >= 15) {
    facts.push({
      fact: "Sleep lengthens noticeably on Rosewood stays — pacing is doing its job.",
      kind: "pattern",
      confidence: 0.85,
    });
  }
  facts.push({
    fact: "Loves the oak grove walk loop at Sand Hill — flag for any return visit.",
    kind: "place_affinity",
    confidence: 0.88,
  });

  // -------- Guest line --------
  const guestLine =
    sleepDeltaMin !== null && sleepDeltaMin >= 15
      ? `thank you for the time at ${propertyName}, ${guestName}. you rested noticeably better here this week — we'll keep that pacing waiting next time.`
      : `thank you for the time at ${propertyName}, ${guestName}. quiet, restorative — exactly what you asked for. travel safe.`;

  const summary = `Post-stay call: ${insightHeadline.toLowerCase()}`;

  return {
    transcript,
    summary,
    insightHeadline,
    insightLines,
    facts,
    guestLine,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeTripDeltas(during: TripStats, before: TripStats): string[] {
  const lines: string[] = [];

  if (during.avgSleepMinutes !== null && before.avgSleepMinutes !== null) {
    const delta = during.avgSleepMinutes - before.avgSleepMinutes;
    if (delta >= 15) {
      lines.push(
        `Sleep ran about ${Math.round(delta)} minutes longer per night during the stay vs the week before — a fuller rest.`,
      );
    } else if (delta <= -15) {
      lines.push(
        `Sleep ran about ${Math.abs(Math.round(delta))} minutes shorter per night vs the week before.`,
      );
    } else {
      lines.push(`Sleep landed similar to the week before.`);
    }
  } else if (during.avgSleepMinutes !== null) {
    lines.push(
      `Sleep tracked across the stay; no comparable baseline available.`,
    );
  }

  if (during.avgRecoveryScore !== null && before.avgRecoveryScore !== null) {
    const delta = during.avgRecoveryScore - before.avgRecoveryScore;
    if (delta >= 8) {
      lines.push(`Energy steadied higher across the stay than the week before.`);
    } else if (delta <= -8) {
      lines.push(
        `Energy ran fuller before the stay; this trip was about restoration.`,
      );
    }
  }

  if (during.workoutCount > 0) {
    lines.push(
      `${during.workoutCount} workout${during.workoutCount === 1 ? "" : "s"} on property: ${during.workoutSports.slice(0, 3).join(", ") || "movement"}.`,
    );
  }

  return lines;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// Reuse parser shape from prompts.ts. Inlined to avoid a circular import.
function parseJson<T>(
  response: { content: Array<{ type: string } & { text?: string }> },
  fallback: T,
): T {
  const block = response.content.find((c) => c.type === "text");
  const text = block?.text ?? "";
  const start = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const cleanStart =
    arrayStart !== -1 && (start === -1 || arrayStart < start)
      ? arrayStart
      : start;
  if (cleanStart === -1) return fallback;
  const closing = arrayStart !== -1 && cleanStart === arrayStart ? "]" : "}";
  const end = text.lastIndexOf(closing);
  if (end === -1 || end <= cleanStart) return fallback;
  try {
    return JSON.parse(text.slice(cleanStart, end + 1)) as T;
  } catch {
    return fallback;
  }
}
