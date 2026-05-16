import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Rosewood Rhythm — state-aware hospitality layer.
 *
 * Design rules baked into this schema:
 *   - Raw biometric signals stay in `signals` (internal). Staff never see them.
 *   - All staff-facing content lives in `messages` with kind-specific payloads
 *     so we can render rich cards in the group thread.
 *   - Consent has an explicit auto-disconnect timestamp tied to checkout.
 *   - Approval status on every message keeps the AI a copilot, not autopilot.
 *   - Memory facts persist across stays so each new property pre-loads context.
 */

// Rosewood property registry. The `senseOfPlace` payload is what makes the
// arrival brief feel like "this property" vs. a generic luxury template.
export const properties = pgTable("rw_properties", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  // { palette, scentSignature, soundtrack, ritualPairings[], welcomeAmenityIdeas[],
  //   movementOptions[], diningSignatures[], heroQuote }
  senseOfPlace: jsonb("sense_of_place").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const guests = pgTable("rw_guests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  photoUrl: text("photo_url"),
  // "sms" | "voice" | "either" — captured during pre-arrival
  contactPreference: text("contact_preference").default("sms").notNull(),
  // Optional: number of merged duplicate profiles found across properties.
  mergedProfileCount: integer("merged_profile_count").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A stay is the unit of choreography. `demoScene` is what the demo controller
// advances to reveal beats in sequence (see /api/scene).
export const stays = pgTable(
  "rw_stays",
  {
    id: serial("id").primaryKey(),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
    checkOut: timestamp("check_out", { withTimezone: true }).notNull(),
    // "pre" | "in" | "post" | "closed"
    phase: text("phase").default("pre").notNull(),
    roomNumber: text("room_number"),
    // Arrival/in-stay automatic settings driven by Rhythm.
    roomTempF: integer("room_temp_f"),
    occasion: text("occasion"), // "board_meeting_friday" | "anniversary" | etc.
    demoScene: integer("demo_scene").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rw_stays_guest_idx").on(t.guestId)],
);

// Visible consent record. The UI surfaces `autoDisconnectAt` everywhere we
// touch signal data so the guest can always see when it stops.
export const consentRecords = pgTable(
  "rw_consent_records",
  {
    id: serial("id").primaryKey(),
    stayId: integer("stay_id")
      .notNull()
      .references(() => stays.id, { onDelete: "cascade" }),
    // "whoop" | "apple" | "fitbit" | "oura" | "garmin" | "conversational"
    source: text("source").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    autoDisconnectAt: timestamp("auto_disconnect_at", {
      withTimezone: true,
    }).notNull(),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    // Bridge to whoop_connections.whoopUserId so advice generation can read
    // real Whoop data (sleep / recovery / workouts / cycles) for this stay
    // instead of the mock payload that used to seed rw_signals.
    whoopUserId: bigint("whoop_user_id", { mode: "number" }),
  },
  (t) => [
    index("rw_consent_stay_idx").on(t.stayId),
    index("rw_consent_whoop_user_idx").on(t.whoopUserId),
  ],
);

// Pre-arrival intake collected from either the 7-day email reply, the
// 1-day-before AI call, or an in-app conversational fallback.
export const intakeAnswers = pgTable(
  "rw_intake_answers",
  {
    id: serial("id").primaryKey(),
    stayId: integer("stay_id")
      .notNull()
      .references(() => stays.id, { onDelete: "cascade" }),
    // "email_form" | "pre_call" | "in_app_chat"
    source: text("source").notNull(),
    // Structured answers extracted by Claude from the conversation.
    // {
    //   arrivalVibe: "restorative" | "social" | "productive" | "celebratory",
    //   pacing: "slow" | "balanced" | "full",
    //   avoid: string[],
    //   foodPreferences: string[],
    //   scent: string | null,
    //   contactPreference: "sms" | "voice" | "either",
    //   wakeWindow: string | null,
    //   eveningWindow: string | null,
    //   occasion: string | null,
    //   comfortFlags: string[]   // e.g., "warmer_room", "softer_pacing"
    // }
    answers: jsonb("answers").notNull(),
    transcript: text("transcript"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rw_intake_stay_idx").on(t.stayId)],
);

// Internal biometric/signal store. NEVER rendered raw to staff or guest UI.
// Translated into hospitality language by the interpret() prompt.
export const signals = pgTable(
  "rw_signals",
  {
    id: serial("id").primaryKey(),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "whoop" | "apple" | ...
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    // Raw-ish payload — the prompt extracts what it needs.
    // For demo we use a normalized shape:
    //   { sleepMinutes, sleepQuality, restingHr, hrvMs, strain, recoveryBand,
    //     travelStrain, cycleComfortMode }
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("rw_signals_guest_captured_idx").on(t.guestId, t.capturedAt)],
);

// The chat-thread message store. ONE table renders both the staff group
// thread AND the guest SMS thread; thread + kind decides how it paints.
export const messages = pgTable(
  "rw_messages",
  {
    id: serial("id").primaryKey(),
    stayId: integer("stay_id")
      .notNull()
      .references(() => stays.id, { onDelete: "cascade" }),
    // "staff" | "guest"
    thread: text("thread").notNull(),
    // "rhythm" | "guest" | "front_desk" | "concierge" | "housekeeping" | "spa"
    author: text("author").notNull(),
    // "ai" | "staff" | "guest"
    authorRole: text("author_role").notNull(),
    // "text" | "arrival_brief" | "daily_rhythm" | "memory_write"
    // | "delight_moment" | "voice_call" | "system_event" | "consent_strip"
    // | "identity_merge"
    kind: text("kind").notNull(),
    // Kind-specific structured payload. Renderers switch on `kind`.
    content: jsonb("content").notNull(),
    // "auto" | "pending" | "approved" | "declined"
    approvalStatus: text("approval_status").default("auto").notNull(),
    // For ordering in deterministic demo sequence.
    sceneOrder: integer("scene_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rw_messages_stay_thread_idx").on(t.stayId, t.thread, t.sceneOrder),
  ],
);

// Durable, cross-property memory. Loaded at the start of each new stay.
export const memoryFacts = pgTable(
  "rw_memory_facts",
  {
    id: serial("id").primaryKey(),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    // "preference" | "pattern" | "avoid" | "occasion" | "place_affinity"
    kind: text("kind").notNull(),
    confidence: doublePrecision("confidence").default(0.8).notNull(),
    sourceStayId: integer("source_stay_id").references(() => stays.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rw_memory_guest_idx").on(t.guestId)],
);

// Types
export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type Guest = typeof guests.$inferSelect;
export type Stay = typeof stays.$inferSelect;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type IntakeAnswer = typeof intakeAnswers.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MemoryFact = typeof memoryFacts.$inferSelect;
