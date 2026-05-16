import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for Recovery Intelligence.
 *
 * After editing, run:
 *   npm run db:generate   # produce a SQL migration from the diff
 *   npm run db:migrate    # apply pending migrations to the database
 *
 * During early prototyping you can skip migrations and use:
 *   npm run db:push       # sync the database directly to this schema
 */

// ---------------------------------------------------------------------------
// WHOOP integration
// ---------------------------------------------------------------------------
//
// WHOOP user IDs are int64 but in practice are far below Number.MAX_SAFE_INTEGER,
// so we use bigint columns with `mode: "number"` for ergonomic JS values.
//
// In v2:
//   - Cycle id: integer (int64) — UNCHANGED from v1
//   - Sleep id: string (UUID) — new in v2
//   - Workout id: string (UUID) — new in v2
//   - Recovery: keyed by cycle_id (int) + sleep_id (UUID), no own id
//
// Encrypted token blobs (IV + ciphertext + auth tag) are base64-encoded into
// text columns; see lib/whoop/crypto.ts.

export const whoopConnections = pgTable("whoop_connections", {
  whoopUserId: bigint("whoop_user_id", { mode: "number" }).primaryKey(),
  accessTokenCiphertext: text("access_token_ciphertext").notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").array().notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const whoopUserProfiles = pgTable("whoop_user_profiles", {
  whoopUserId: bigint("whoop_user_id", { mode: "number" }).primaryKey(),
  email: text("email").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const whoopBodyMeasurements = pgTable("whoop_body_measurements", {
  whoopUserId: bigint("whoop_user_id", { mode: "number" }).primaryKey(),
  heightMeter: doublePrecision("height_meter").notNull(),
  weightKilogram: doublePrecision("weight_kilogram").notNull(),
  maxHeartRate: integer("max_heart_rate").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const whoopCycles = pgTable(
  "whoop_cycles",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    whoopUserId: bigint("whoop_user_id", { mode: "number" }).notNull(),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }),
    timezoneOffset: text("timezone_offset").notNull(),
    scoreState: text("score_state").notNull(),
    strain: doublePrecision("strain"),
    kilojoule: doublePrecision("kilojoule"),
    averageHeartRate: integer("average_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    raw: jsonb("raw").notNull(),
    createdAtWhoop: timestamp("created_at_whoop", {
      withTimezone: true,
    }).notNull(),
    updatedAtWhoop: timestamp("updated_at_whoop", {
      withTimezone: true,
    }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("whoop_cycles_user_start_idx").on(t.whoopUserId, t.start.desc()),
  ],
);

export const whoopRecoveries = pgTable(
  "whoop_recoveries",
  {
    cycleId: bigint("cycle_id", { mode: "number" }).primaryKey(),
    sleepId: text("sleep_id").notNull(),
    whoopUserId: bigint("whoop_user_id", { mode: "number" }).notNull(),
    scoreState: text("score_state").notNull(),
    userCalibrating: boolean("user_calibrating"),
    recoveryScore: doublePrecision("recovery_score"),
    restingHeartRate: integer("resting_heart_rate"),
    hrvRmssdMilli: doublePrecision("hrv_rmssd_milli"),
    spo2Percentage: doublePrecision("spo2_percentage"),
    skinTempCelsius: doublePrecision("skin_temp_celsius"),
    raw: jsonb("raw").notNull(),
    createdAtWhoop: timestamp("created_at_whoop", {
      withTimezone: true,
    }).notNull(),
    updatedAtWhoop: timestamp("updated_at_whoop", {
      withTimezone: true,
    }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("whoop_recoveries_user_idx").on(t.whoopUserId),
    index("whoop_recoveries_sleep_idx").on(t.sleepId),
  ],
);

export const whoopSleeps = pgTable(
  "whoop_sleeps",
  {
    id: text("id").primaryKey(),
    whoopUserId: bigint("whoop_user_id", { mode: "number" }).notNull(),
    cycleId: bigint("cycle_id", { mode: "number" }).notNull(),
    v1Id: bigint("v1_id", { mode: "number" }),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    timezoneOffset: text("timezone_offset").notNull(),
    nap: boolean("nap").notNull(),
    scoreState: text("score_state").notNull(),
    sleepPerformancePercentage: doublePrecision(
      "sleep_performance_percentage",
    ),
    sleepConsistencyPercentage: doublePrecision(
      "sleep_consistency_percentage",
    ),
    sleepEfficiencyPercentage: doublePrecision("sleep_efficiency_percentage"),
    respiratoryRate: doublePrecision("respiratory_rate"),
    totalInBedTimeMilli: integer("total_in_bed_time_milli"),
    totalAwakeTimeMilli: integer("total_awake_time_milli"),
    totalLightSleepTimeMilli: integer("total_light_sleep_time_milli"),
    totalSlowWaveSleepTimeMilli: integer("total_slow_wave_sleep_time_milli"),
    totalRemSleepTimeMilli: integer("total_rem_sleep_time_milli"),
    sleepCycleCount: integer("sleep_cycle_count"),
    disturbanceCount: integer("disturbance_count"),
    raw: jsonb("raw").notNull(),
    createdAtWhoop: timestamp("created_at_whoop", {
      withTimezone: true,
    }).notNull(),
    updatedAtWhoop: timestamp("updated_at_whoop", {
      withTimezone: true,
    }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("whoop_sleeps_user_start_idx").on(t.whoopUserId, t.start.desc()),
  ],
);

export const whoopWorkouts = pgTable(
  "whoop_workouts",
  {
    id: text("id").primaryKey(),
    whoopUserId: bigint("whoop_user_id", { mode: "number" }).notNull(),
    v1Id: bigint("v1_id", { mode: "number" }),
    sportName: text("sport_name").notNull(),
    sportId: integer("sport_id"),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    timezoneOffset: text("timezone_offset").notNull(),
    scoreState: text("score_state").notNull(),
    strain: doublePrecision("strain"),
    averageHeartRate: integer("average_heart_rate"),
    maxHeartRate: integer("max_heart_rate"),
    kilojoule: doublePrecision("kilojoule"),
    percentRecorded: doublePrecision("percent_recorded"),
    distanceMeter: doublePrecision("distance_meter"),
    altitudeGainMeter: doublePrecision("altitude_gain_meter"),
    altitudeChangeMeter: doublePrecision("altitude_change_meter"),
    zoneZeroMilli: integer("zone_zero_milli"),
    zoneOneMilli: integer("zone_one_milli"),
    zoneTwoMilli: integer("zone_two_milli"),
    zoneThreeMilli: integer("zone_three_milli"),
    zoneFourMilli: integer("zone_four_milli"),
    zoneFiveMilli: integer("zone_five_milli"),
    raw: jsonb("raw").notNull(),
    createdAtWhoop: timestamp("created_at_whoop", {
      withTimezone: true,
    }).notNull(),
    updatedAtWhoop: timestamp("updated_at_whoop", {
      withTimezone: true,
    }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("whoop_workouts_user_start_idx").on(t.whoopUserId, t.start.desc()),
  ],
);

export const whoopWebhookEvents = pgTable(
  "whoop_webhook_events",
  {
    id: serial("id").primaryKey(),
    traceId: text("trace_id").notNull(),
    type: text("type").notNull(),
    whoopUserId: bigint("whoop_user_id", { mode: "number" }).notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
  },
  (t) => [
    uniqueIndex("whoop_webhook_events_trace_id_uniq").on(t.traceId),
    index("whoop_webhook_events_user_idx").on(t.whoopUserId),
  ],
);

// Convenience type aliases for inserting / selecting rows.
export type WhoopConnection = typeof whoopConnections.$inferSelect;
export type NewWhoopConnection = typeof whoopConnections.$inferInsert;
export type WhoopUserProfile = typeof whoopUserProfiles.$inferSelect;
export type WhoopBodyMeasurement = typeof whoopBodyMeasurements.$inferSelect;
export type WhoopCycle = typeof whoopCycles.$inferSelect;
export type WhoopRecovery = typeof whoopRecoveries.$inferSelect;
export type WhoopSleep = typeof whoopSleeps.$inferSelect;
export type WhoopWorkout = typeof whoopWorkouts.$inferSelect;
export type WhoopWebhookEvent = typeof whoopWebhookEvents.$inferSelect;
export type NewWhoopWebhookEvent = typeof whoopWebhookEvents.$inferInsert;
