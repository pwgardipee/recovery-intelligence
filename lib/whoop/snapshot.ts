import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  whoopBodyMeasurements,
  whoopCycles,
  whoopRecoveries,
  whoopSleeps,
  whoopUserProfiles,
  whoopWorkouts,
} from "@/lib/db/schema";

/**
 * Whoop snapshot — a single read across all whoop_* tables anchored at
 * `asOf` (defaults to now). Returns a richly structured payload that the
 * hospitality translator can convert into Rose-voice copy without ever
 * seeing raw metrics elsewhere.
 *
 * Read pattern: most recent sleep / recovery / cycle relative to `asOf`,
 * plus any workouts that ended within the lookback window. We do NOT join
 * — these tables are independent in WHOOP's model — and we tolerate any
 * one of them being missing.
 */

export type SleepBand = "short" | "partial" | "fuller";
export type RecoveryBand = "low" | "mid" | "high" | "calibrating";
export type StrainBand = "easy" | "moderate" | "hard" | "very_hard";

export interface WorkoutSnapshot {
  id: string;
  sportName: string;
  start: string; // ISO
  end: string; // ISO
  durationMinutes: number;
  strain: number | null;
  strainBand: StrainBand | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  kilojoule: number | null;
  distanceMeter: number | null;
  altitudeGainMeter: number | null;
  endedHoursAgo: number;
}

export interface SleepSnapshot {
  id: string;
  start: string;
  end: string;
  nap: boolean;
  totalSleepMinutes: number | null;
  inBedMinutes: number | null;
  awakeMinutes: number | null;
  sleepPerformancePercentage: number | null;
  sleepEfficiencyPercentage: number | null;
  band: SleepBand | null;
  endedHoursAgo: number;
}

export interface RecoverySnapshot {
  cycleId: number;
  sleepId: string;
  recoveryScore: number | null;
  restingHeartRate: number | null;
  hrvRmssdMilli: number | null;
  band: RecoveryBand | null;
  userCalibrating: boolean | null;
}

export interface CycleSnapshot {
  id: number;
  start: string;
  end: string | null;
  strain: number | null;
  strainBand: StrainBand | null;
  kilojoule: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
}

export interface BodyMeasurementSnapshot {
  heightMeter: number;
  weightKilogram: number;
  maxHeartRate: number;
}

export interface ProfileSnapshot {
  email: string;
  firstName: string;
  lastName: string;
}

export interface WhoopSnapshotDerived {
  // Hospitality-relevant flags pre-computed from the raw data.
  recentWorkout: WorkoutSnapshot | null; // most recent workout in last 24h
  heavyStrainToday: boolean; // current cycle strain >= "hard"
  poorSleepLastNight: boolean; // band === "short"
  fullSleepLastNight: boolean; // band === "fuller"
  lowRecoveryToday: boolean;
  workoutNeedsRefuel: boolean; // recent workout w/ high strain or kj
  workoutsLast48h: WorkoutSnapshot[];
}

export interface WhoopSnapshot {
  whoopUserId: number;
  asOf: string; // ISO of anchor time used for this read
  profile: ProfileSnapshot | null;
  body: BodyMeasurementSnapshot | null;
  cycle: CycleSnapshot | null;
  sleep: SleepSnapshot | null;
  recovery: RecoverySnapshot | null;
  workoutsLast48h: WorkoutSnapshot[];
  derived: WhoopSnapshotDerived;
  // hasAnyData=false means "we have a connection but no synced rows yet".
  hasAnyData: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

function strainBand(strain: number | null): StrainBand | null {
  if (strain === null || strain === undefined) return null;
  // WHOOP strain is 0–21. Bands are eyeballed for hospitality phrasing.
  if (strain < 8) return "easy";
  if (strain < 14) return "moderate";
  if (strain < 18) return "hard";
  return "very_hard";
}

function recoveryBand(score: number | null): RecoveryBand | null {
  if (score === null || score === undefined) return null;
  if (score < 34) return "low";
  if (score < 67) return "mid";
  return "high";
}

function sleepBand(totalSleepMinutes: number | null): SleepBand | null {
  if (totalSleepMinutes === null || totalSleepMinutes === undefined) return null;
  if (totalSleepMinutes < 360) return "short"; // < 6h
  if (totalSleepMinutes < 420) return "partial"; // 6–7h
  return "fuller"; // 7h+
}

function totalSleepMinutesFrom(row: {
  totalInBedTimeMilli: number | null;
  totalAwakeTimeMilli: number | null;
  totalLightSleepTimeMilli: number | null;
  totalSlowWaveSleepTimeMilli: number | null;
  totalRemSleepTimeMilli: number | null;
}): number | null {
  // Prefer summed sleep stages when present (matches Whoop's "asleep duration"),
  // fall back to in-bed minus awake.
  const stages = [
    row.totalLightSleepTimeMilli,
    row.totalSlowWaveSleepTimeMilli,
    row.totalRemSleepTimeMilli,
  ];
  if (stages.every((m) => m !== null && m !== undefined)) {
    const total = stages.reduce<number>((acc, m) => acc + (m ?? 0), 0);
    return Math.round(total / 60000);
  }
  if (row.totalInBedTimeMilli !== null && row.totalInBedTimeMilli !== undefined) {
    const awake = row.totalAwakeTimeMilli ?? 0;
    return Math.round((row.totalInBedTimeMilli - awake) / 60000);
  }
  return null;
}

/**
 * Aggregate Whoop signal across a date range. Used by the post-stay
 * "trip wrap" to compare the stay window against the equivalent number
 * of days BEFORE the stay — surfacing changes like "+53 min sleep per
 * night" in hospitality language.
 *
 * Numbers stay raw here. They are translated via `describeTripDeltas`
 * inside lib/ai/checkins.ts before reaching any prompt or renderer.
 */
export interface TripStatsResult {
  avgSleepMinutes: number | null;
  avgRecoveryScore: number | null;
  workoutCount: number;
  workoutSports: string[];
  avgStrain: number | null;
  daysWithData: number;
}

export async function buildTripStats(
  whoopUserId: number,
  range: { start: Date; end: Date },
): Promise<TripStatsResult> {
  const sleeps = await db
    .select()
    .from(whoopSleeps)
    .where(
      and(
        eq(whoopSleeps.whoopUserId, whoopUserId),
        eq(whoopSleeps.nap, false),
        gte(whoopSleeps.end, range.start),
        lte(whoopSleeps.end, range.end),
      ),
    );

  const sleepMinutes = sleeps
    .map(totalSleepMinutesFrom)
    .filter((m): m is number => m !== null);
  const avgSleepMinutes =
    sleepMinutes.length > 0
      ? Math.round(
          sleepMinutes.reduce((a, b) => a + b, 0) / sleepMinutes.length,
        )
      : null;

  const recoveries = await db
    .select()
    .from(whoopRecoveries)
    .where(eq(whoopRecoveries.whoopUserId, whoopUserId));
  // Recovery isn't time-stamped directly — join via cycleId.
  const cyclesInRange = await db
    .select()
    .from(whoopCycles)
    .where(
      and(
        eq(whoopCycles.whoopUserId, whoopUserId),
        gte(whoopCycles.start, range.start),
        lte(whoopCycles.start, range.end),
      ),
    );
  const cycleIdsInRange = new Set(cyclesInRange.map((c) => c.id));
  const recoveryScores = recoveries
    .filter((r) => cycleIdsInRange.has(r.cycleId))
    .map((r) => r.recoveryScore)
    .filter((n): n is number => n !== null);
  const avgRecoveryScore =
    recoveryScores.length > 0
      ? Math.round(
          recoveryScores.reduce((a, b) => a + b, 0) / recoveryScores.length,
        )
      : null;

  const cycleStrains = cyclesInRange
    .map((c) => c.strain)
    .filter((n): n is number => n !== null);
  const avgStrain =
    cycleStrains.length > 0
      ? Number(
          (
            cycleStrains.reduce((a, b) => a + b, 0) / cycleStrains.length
          ).toFixed(1),
        )
      : null;

  const workouts = await db
    .select()
    .from(whoopWorkouts)
    .where(
      and(
        eq(whoopWorkouts.whoopUserId, whoopUserId),
        gte(whoopWorkouts.end, range.start),
        lte(whoopWorkouts.end, range.end),
      ),
    );

  const workoutSports = Array.from(
    new Set(workouts.map((w) => w.sportName).filter(Boolean)),
  ) as string[];

  const daysWithData = new Set([
    ...sleeps.map((s) => s.end.toDateString()),
    ...cyclesInRange.map((c) => c.start.toDateString()),
    ...workouts.map((w) => w.end.toDateString()),
  ]).size;

  return {
    avgSleepMinutes,
    avgRecoveryScore,
    workoutCount: workouts.length,
    workoutSports,
    avgStrain,
    daysWithData,
  };
}

export async function buildWhoopSnapshot(
  whoopUserId: number,
  asOfInput?: Date,
): Promise<WhoopSnapshot> {
  const asOf = asOfInput ?? new Date();
  const lookback48h = new Date(asOf.getTime() - 48 * HOUR_MS);

  const [profileRow] = await db
    .select()
    .from(whoopUserProfiles)
    .where(eq(whoopUserProfiles.whoopUserId, whoopUserId))
    .limit(1);

  const [bodyRow] = await db
    .select()
    .from(whoopBodyMeasurements)
    .where(eq(whoopBodyMeasurements.whoopUserId, whoopUserId))
    .limit(1);

  // Most recent cycle that has started by `asOf`.
  const [cycleRow] = await db
    .select()
    .from(whoopCycles)
    .where(
      and(
        eq(whoopCycles.whoopUserId, whoopUserId),
        lte(whoopCycles.start, asOf),
      ),
    )
    .orderBy(desc(whoopCycles.start))
    .limit(1);

  // Most recent non-nap sleep that has ended by `asOf`.
  const [sleepRow] = await db
    .select()
    .from(whoopSleeps)
    .where(
      and(
        eq(whoopSleeps.whoopUserId, whoopUserId),
        eq(whoopSleeps.nap, false),
        lte(whoopSleeps.end, asOf),
      ),
    )
    .orderBy(desc(whoopSleeps.start))
    .limit(1);

  // Recovery is keyed by sleep_id; pull the one for the most recent sleep
  // when we have it, otherwise the most recent recovery overall.
  let recoveryRow:
    | (typeof whoopRecoveries.$inferSelect)
    | undefined;
  if (sleepRow) {
    [recoveryRow] = await db
      .select()
      .from(whoopRecoveries)
      .where(
        and(
          eq(whoopRecoveries.whoopUserId, whoopUserId),
          eq(whoopRecoveries.sleepId, sleepRow.id),
        ),
      )
      .limit(1);
  }
  if (!recoveryRow) {
    [recoveryRow] = await db
      .select()
      .from(whoopRecoveries)
      .where(eq(whoopRecoveries.whoopUserId, whoopUserId))
      .orderBy(desc(whoopRecoveries.cycleId))
      .limit(1);
  }

  const workoutRows = await db
    .select()
    .from(whoopWorkouts)
    .where(
      and(
        eq(whoopWorkouts.whoopUserId, whoopUserId),
        gte(whoopWorkouts.end, lookback48h),
        lte(whoopWorkouts.end, asOf),
      ),
    )
    .orderBy(desc(whoopWorkouts.end));

  const workoutsLast48h: WorkoutSnapshot[] = workoutRows.map((w) => {
    const start = w.start;
    const end = w.end;
    const durationMs = end.getTime() - start.getTime();
    return {
      id: w.id,
      sportName: w.sportName,
      start: start.toISOString(),
      end: end.toISOString(),
      durationMinutes: Math.round(durationMs / 60000),
      strain: w.strain,
      strainBand: strainBand(w.strain),
      averageHeartRate: w.averageHeartRate,
      maxHeartRate: w.maxHeartRate,
      kilojoule: w.kilojoule,
      distanceMeter: w.distanceMeter,
      altitudeGainMeter: w.altitudeGainMeter,
      endedHoursAgo: Math.max(
        0,
        Math.round((asOf.getTime() - end.getTime()) / HOUR_MS),
      ),
    };
  });

  const recentWorkout = workoutsLast48h.find((w) => w.endedHoursAgo <= 24) ?? null;

  const profile: ProfileSnapshot | null = profileRow
    ? {
        email: profileRow.email,
        firstName: profileRow.firstName,
        lastName: profileRow.lastName,
      }
    : null;

  const body: BodyMeasurementSnapshot | null = bodyRow
    ? {
        heightMeter: bodyRow.heightMeter,
        weightKilogram: bodyRow.weightKilogram,
        maxHeartRate: bodyRow.maxHeartRate,
      }
    : null;

  const cycle: CycleSnapshot | null = cycleRow
    ? {
        id: cycleRow.id,
        start: cycleRow.start.toISOString(),
        end: cycleRow.end ? cycleRow.end.toISOString() : null,
        strain: cycleRow.strain,
        strainBand: strainBand(cycleRow.strain),
        kilojoule: cycleRow.kilojoule,
        averageHeartRate: cycleRow.averageHeartRate,
        maxHeartRate: cycleRow.maxHeartRate,
      }
    : null;

  const totalSleepMinutes = sleepRow ? totalSleepMinutesFrom(sleepRow) : null;
  const sleep: SleepSnapshot | null = sleepRow
    ? {
        id: sleepRow.id,
        start: sleepRow.start.toISOString(),
        end: sleepRow.end.toISOString(),
        nap: sleepRow.nap,
        totalSleepMinutes,
        inBedMinutes:
          sleepRow.totalInBedTimeMilli !== null
            ? Math.round(sleepRow.totalInBedTimeMilli / 60000)
            : null,
        awakeMinutes:
          sleepRow.totalAwakeTimeMilli !== null
            ? Math.round(sleepRow.totalAwakeTimeMilli / 60000)
            : null,
        sleepPerformancePercentage: sleepRow.sleepPerformancePercentage,
        sleepEfficiencyPercentage: sleepRow.sleepEfficiencyPercentage,
        band: sleepBand(totalSleepMinutes),
        endedHoursAgo: Math.max(
          0,
          Math.round((asOf.getTime() - sleepRow.end.getTime()) / HOUR_MS),
        ),
      }
    : null;

  const recovery: RecoverySnapshot | null = recoveryRow
    ? {
        cycleId: recoveryRow.cycleId,
        sleepId: recoveryRow.sleepId,
        recoveryScore: recoveryRow.recoveryScore,
        restingHeartRate: recoveryRow.restingHeartRate,
        hrvRmssdMilli: recoveryRow.hrvRmssdMilli,
        band: recoveryRow.userCalibrating
          ? "calibrating"
          : recoveryBand(recoveryRow.recoveryScore),
        userCalibrating: recoveryRow.userCalibrating,
      }
    : null;

  const heavyStrainToday =
    cycle?.strainBand === "hard" || cycle?.strainBand === "very_hard";
  const workoutNeedsRefuel = !!(
    recentWorkout &&
    (recentWorkout.strainBand === "hard" ||
      recentWorkout.strainBand === "very_hard" ||
      (recentWorkout.kilojoule !== null && recentWorkout.kilojoule >= 2000))
  );

  const derived: WhoopSnapshotDerived = {
    recentWorkout,
    heavyStrainToday,
    poorSleepLastNight: sleep?.band === "short",
    fullSleepLastNight: sleep?.band === "fuller",
    lowRecoveryToday: recovery?.band === "low",
    workoutNeedsRefuel,
    workoutsLast48h,
  };

  const hasAnyData = !!(profile || body || cycle || sleep || recovery || workoutsLast48h.length);

  return {
    whoopUserId,
    asOf: asOf.toISOString(),
    profile,
    body,
    cycle,
    sleep,
    recovery,
    workoutsLast48h,
    derived,
    hasAnyData,
  };
}
