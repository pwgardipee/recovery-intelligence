import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  whoopBodyMeasurements,
  whoopConnections,
  whoopCycles,
  whoopRecoveries,
  whoopSleeps,
  whoopUserProfiles,
  whoopWorkouts,
  type WhoopConnection,
} from "@/lib/db/schema";

import { whoopGetJson } from "./client";

/**
 * Per-resource sync helpers.
 *
 * Each `syncX` is idempotent: it issues a GET to the WHOOP v2 REST API and
 * upserts the result. Soft-delete handlers (`markXDeleted`) flip `deleted_at`
 * without removing the row, so we keep history.
 *
 * Server URL: https://api.prod.whoop.com/developer
 * Endpoints:  /v2/cycle, /v2/cycle/{id}, /v2/cycle/{id}/recovery,
 *             /v2/activity/sleep, /v2/activity/sleep/{uuid},
 *             /v2/activity/workout, /v2/activity/workout/{uuid},
 *             /v2/user/profile/basic, /v2/user/measurement/body
 */

// ---------------------------------------------------------------------------
// WHOOP v2 response types (mirror the OpenAPI spec, only the fields we use)
// ---------------------------------------------------------------------------

interface ScoreStateBase {
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE";
}

export interface WhoopCycleResponse extends ScoreStateBase {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end?: string;
  timezone_offset: string;
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

export interface WhoopSleepResponse extends ScoreStateBase {
  id: string;
  v1_id?: number;
  cycle_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

export interface WhoopWorkoutResponse extends ScoreStateBase {
  id: string;
  v1_id?: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string;
  sport_id?: number;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

export interface WhoopRecoveryResponse extends ScoreStateBase {
  cycle_id: number;
  sleep_id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage: number;
    skin_temp_celsius: number;
  };
}

export interface WhoopUserProfileResponse {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface WhoopBodyMeasurementResponse {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

interface PaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

// ---------------------------------------------------------------------------
// Profile + body measurement
// ---------------------------------------------------------------------------

export async function syncUserProfile(
  connection: WhoopConnection,
): Promise<WhoopUserProfileResponse | null> {
  const profile = await whoopGetJson<WhoopUserProfileResponse>(
    connection,
    "/v2/user/profile/basic",
  );
  if (!profile) return null;
  await db
    .insert(whoopUserProfiles)
    .values({
      whoopUserId: profile.user_id,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whoopUserProfiles.whoopUserId,
      set: {
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        updatedAt: new Date(),
      },
    });
  return profile;
}

export async function syncBodyMeasurement(
  connection: WhoopConnection,
): Promise<WhoopBodyMeasurementResponse | null> {
  const body = await whoopGetJson<WhoopBodyMeasurementResponse>(
    connection,
    "/v2/user/measurement/body",
    { tolerate: [404] },
  );
  if (!body) return null;
  await db
    .insert(whoopBodyMeasurements)
    .values({
      whoopUserId: connection.whoopUserId,
      heightMeter: body.height_meter,
      weightKilogram: body.weight_kilogram,
      maxHeartRate: body.max_heart_rate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whoopBodyMeasurements.whoopUserId,
      set: {
        heightMeter: body.height_meter,
        weightKilogram: body.weight_kilogram,
        maxHeartRate: body.max_heart_rate,
        updatedAt: new Date(),
      },
    });
  return body;
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

export async function syncCycle(
  connection: WhoopConnection,
  cycleId: number,
): Promise<WhoopCycleResponse | null> {
  const cycle = await whoopGetJson<WhoopCycleResponse>(
    connection,
    `/v2/cycle/${cycleId}`,
    { tolerate: [404] },
  );
  if (!cycle) return null;
  await upsertCycle(cycle);
  return cycle;
}

async function upsertCycle(cycle: WhoopCycleResponse): Promise<void> {
  const values = {
    id: cycle.id,
    whoopUserId: cycle.user_id,
    start: new Date(cycle.start),
    end: cycle.end ? new Date(cycle.end) : null,
    timezoneOffset: cycle.timezone_offset,
    scoreState: cycle.score_state,
    strain: cycle.score?.strain ?? null,
    kilojoule: cycle.score?.kilojoule ?? null,
    averageHeartRate: cycle.score?.average_heart_rate ?? null,
    maxHeartRate: cycle.score?.max_heart_rate ?? null,
    raw: cycle,
    createdAtWhoop: new Date(cycle.created_at),
    updatedAtWhoop: new Date(cycle.updated_at),
    deletedAt: null,
  };
  await db
    .insert(whoopCycles)
    .values(values)
    .onConflictDoUpdate({ target: whoopCycles.id, set: values });
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

export async function syncSleep(
  connection: WhoopConnection,
  sleepId: string,
): Promise<WhoopSleepResponse | null> {
  const sleep = await whoopGetJson<WhoopSleepResponse>(
    connection,
    `/v2/activity/sleep/${sleepId}`,
    { tolerate: [404] },
  );
  if (!sleep) return null;
  await upsertSleep(sleep);
  return sleep;
}

async function upsertSleep(sleep: WhoopSleepResponse): Promise<void> {
  const summary = sleep.score?.stage_summary;
  const values = {
    id: sleep.id,
    whoopUserId: sleep.user_id,
    cycleId: sleep.cycle_id,
    v1Id: sleep.v1_id ?? null,
    start: new Date(sleep.start),
    end: new Date(sleep.end),
    timezoneOffset: sleep.timezone_offset,
    nap: sleep.nap,
    scoreState: sleep.score_state,
    sleepPerformancePercentage:
      sleep.score?.sleep_performance_percentage ?? null,
    sleepConsistencyPercentage:
      sleep.score?.sleep_consistency_percentage ?? null,
    sleepEfficiencyPercentage:
      sleep.score?.sleep_efficiency_percentage ?? null,
    respiratoryRate: sleep.score?.respiratory_rate ?? null,
    totalInBedTimeMilli: summary?.total_in_bed_time_milli ?? null,
    totalAwakeTimeMilli: summary?.total_awake_time_milli ?? null,
    totalLightSleepTimeMilli: summary?.total_light_sleep_time_milli ?? null,
    totalSlowWaveSleepTimeMilli:
      summary?.total_slow_wave_sleep_time_milli ?? null,
    totalRemSleepTimeMilli: summary?.total_rem_sleep_time_milli ?? null,
    sleepCycleCount: summary?.sleep_cycle_count ?? null,
    disturbanceCount: summary?.disturbance_count ?? null,
    raw: sleep,
    createdAtWhoop: new Date(sleep.created_at),
    updatedAtWhoop: new Date(sleep.updated_at),
    deletedAt: null,
  };
  await db
    .insert(whoopSleeps)
    .values(values)
    .onConflictDoUpdate({ target: whoopSleeps.id, set: values });
}

// ---------------------------------------------------------------------------
// Workout
// ---------------------------------------------------------------------------

export async function syncWorkout(
  connection: WhoopConnection,
  workoutId: string,
): Promise<WhoopWorkoutResponse | null> {
  const workout = await whoopGetJson<WhoopWorkoutResponse>(
    connection,
    `/v2/activity/workout/${workoutId}`,
    { tolerate: [404] },
  );
  if (!workout) return null;
  await upsertWorkout(workout);
  return workout;
}

async function upsertWorkout(workout: WhoopWorkoutResponse): Promise<void> {
  const zd = workout.score?.zone_durations;
  const values = {
    id: workout.id,
    whoopUserId: workout.user_id,
    v1Id: workout.v1_id ?? null,
    sportName: workout.sport_name,
    sportId: workout.sport_id ?? null,
    start: new Date(workout.start),
    end: new Date(workout.end),
    timezoneOffset: workout.timezone_offset,
    scoreState: workout.score_state,
    strain: workout.score?.strain ?? null,
    averageHeartRate: workout.score?.average_heart_rate ?? null,
    maxHeartRate: workout.score?.max_heart_rate ?? null,
    kilojoule: workout.score?.kilojoule ?? null,
    percentRecorded: workout.score?.percent_recorded ?? null,
    distanceMeter: workout.score?.distance_meter ?? null,
    altitudeGainMeter: workout.score?.altitude_gain_meter ?? null,
    altitudeChangeMeter: workout.score?.altitude_change_meter ?? null,
    zoneZeroMilli: zd?.zone_zero_milli ?? null,
    zoneOneMilli: zd?.zone_one_milli ?? null,
    zoneTwoMilli: zd?.zone_two_milli ?? null,
    zoneThreeMilli: zd?.zone_three_milli ?? null,
    zoneFourMilli: zd?.zone_four_milli ?? null,
    zoneFiveMilli: zd?.zone_five_milli ?? null,
    raw: workout,
    createdAtWhoop: new Date(workout.created_at),
    updatedAtWhoop: new Date(workout.updated_at),
    deletedAt: null,
  };
  await db
    .insert(whoopWorkouts)
    .values(values)
    .onConflictDoUpdate({ target: whoopWorkouts.id, set: values });
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export async function syncRecoveryByCycleId(
  connection: WhoopConnection,
  cycleId: number,
): Promise<WhoopRecoveryResponse | null> {
  const recovery = await whoopGetJson<WhoopRecoveryResponse>(
    connection,
    `/v2/cycle/${cycleId}/recovery`,
    { tolerate: [404] },
  );
  if (!recovery) return null;
  await upsertRecovery(recovery);
  return recovery;
}

/**
 * Resolve a recovery from a v2 webhook (which carries sleep_id, not cycle_id).
 * Strategy:
 *   1. Fetch the sleep — its `cycle_id` field gives us the associated cycle
 *   2. Use that cycle id to fetch the recovery
 * The sleep itself is upserted as a useful side-effect.
 */
export async function syncRecoveryBySleepId(
  connection: WhoopConnection,
  sleepId: string,
): Promise<WhoopRecoveryResponse | null> {
  const sleep = await syncSleep(connection, sleepId);
  if (!sleep) return null;
  return syncRecoveryByCycleId(connection, sleep.cycle_id);
}

async function upsertRecovery(
  recovery: WhoopRecoveryResponse,
): Promise<void> {
  const values = {
    cycleId: recovery.cycle_id,
    sleepId: recovery.sleep_id,
    whoopUserId: recovery.user_id,
    scoreState: recovery.score_state,
    userCalibrating: recovery.score?.user_calibrating ?? null,
    recoveryScore: recovery.score?.recovery_score ?? null,
    restingHeartRate: recovery.score?.resting_heart_rate ?? null,
    hrvRmssdMilli: recovery.score?.hrv_rmssd_milli ?? null,
    spo2Percentage: recovery.score?.spo2_percentage ?? null,
    skinTempCelsius: recovery.score?.skin_temp_celsius ?? null,
    raw: recovery,
    createdAtWhoop: new Date(recovery.created_at),
    updatedAtWhoop: new Date(recovery.updated_at),
    deletedAt: null,
  };
  await db
    .insert(whoopRecoveries)
    .values(values)
    .onConflictDoUpdate({ target: whoopRecoveries.cycleId, set: values });
}

// ---------------------------------------------------------------------------
// Soft-delete handlers (for *.deleted webhooks)
// ---------------------------------------------------------------------------

export async function markSleepDeleted(sleepId: string): Promise<void> {
  await db
    .update(whoopSleeps)
    .set({ deletedAt: new Date() })
    .where(eq(whoopSleeps.id, sleepId));
}

export async function markWorkoutDeleted(workoutId: string): Promise<void> {
  await db
    .update(whoopWorkouts)
    .set({ deletedAt: new Date() })
    .where(eq(whoopWorkouts.id, workoutId));
}

export async function markRecoveryDeletedBySleepId(
  sleepId: string,
): Promise<void> {
  await db
    .update(whoopRecoveries)
    .set({ deletedAt: new Date() })
    .where(eq(whoopRecoveries.sleepId, sleepId));
}

// ---------------------------------------------------------------------------
// Backfill — pull a window of recent data for a freshly connected user
// ---------------------------------------------------------------------------

const COLLECTION_PAGE_SIZE = 25;

async function paginate<T>(
  connection: WhoopConnection,
  basePath: string,
  start: Date,
  end: Date,
  onPage: (page: T[]) => Promise<void>,
): Promise<void> {
  let nextToken: string | undefined;
  do {
    const params = new URLSearchParams({
      limit: String(COLLECTION_PAGE_SIZE),
      start: start.toISOString(),
      end: end.toISOString(),
    });
    if (nextToken) params.set("nextToken", nextToken);
    const page = await whoopGetJson<PaginatedResponse<T>>(
      connection,
      `${basePath}?${params.toString()}`,
    );
    if (!page) break;
    if (page.records.length > 0) await onPage(page.records);
    nextToken = page.next_token;
  } while (nextToken);
}

/**
 * Pull the user's data for the last `daysBack` days. Designed to be invoked
 * via `waitUntil` immediately after a successful OAuth connect — runs to
 * completion in the background even after we've redirected the user.
 *
 * Resilient to partial failure: each resource is wrapped so one failure
 * doesn't abort the rest. Errors are logged and `last_synced_at` is updated
 * even on partial success.
 */
export async function backfill(
  connection: WhoopConnection,
  daysBack = 30,
): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const safe = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[whoop:backfill] ${label} failed:`, err);
    }
  };

  await safe("profile", async () => {
    await syncUserProfile(connection);
  });
  await safe("body_measurement", async () => {
    await syncBodyMeasurement(connection);
  });

  await safe("cycles", () =>
    paginate<WhoopCycleResponse>(
      connection,
      "/v2/cycle",
      start,
      end,
      async (records) => {
        for (const cycle of records) await upsertCycle(cycle);
      },
    ),
  );

  await safe("sleeps", () =>
    paginate<WhoopSleepResponse>(
      connection,
      "/v2/activity/sleep",
      start,
      end,
      async (records) => {
        for (const sleep of records) await upsertSleep(sleep);
      },
    ),
  );

  await safe("workouts", () =>
    paginate<WhoopWorkoutResponse>(
      connection,
      "/v2/activity/workout",
      start,
      end,
      async (records) => {
        for (const workout of records) await upsertWorkout(workout);
      },
    ),
  );

  await safe("recoveries", () =>
    paginate<WhoopRecoveryResponse>(
      connection,
      "/v2/recovery",
      start,
      end,
      async (records) => {
        for (const recovery of records) await upsertRecovery(recovery);
      },
    ),
  );

  await db
    .update(whoopConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(whoopConnections.whoopUserId, connection.whoopUserId));
}
