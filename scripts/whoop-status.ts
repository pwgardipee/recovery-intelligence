import "./_env";

import { desc, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { db } from "../lib/db";
import {
  whoopBodyMeasurements,
  whoopConnections,
  whoopCycles,
  whoopRecoveries,
  whoopSleeps,
  whoopUserProfiles,
  whoopWebhookEvents,
  whoopWorkouts,
} from "../lib/db/schema";

async function main() {
  const connections = await db.select().from(whoopConnections);
  console.log(`\n=== whoop_connections (${connections.length}) ===`);
  for (const c of connections) {
    console.log({
      whoop_user_id: c.whoopUserId,
      scopes: c.scopes,
      expires_at: c.expiresAt,
      connected_at: c.connectedAt,
      last_synced_at: c.lastSyncedAt,
      revoked: !!c.revokedAt,
    });
  }

  const profiles = await db.select().from(whoopUserProfiles);
  console.log(`\n=== whoop_user_profiles (${profiles.length}) ===`);
  for (const p of profiles)
    console.log(`  ${p.whoopUserId}  ${p.firstName} ${p.lastName}  <${p.email}>`);

  const body = await db.select().from(whoopBodyMeasurements);
  console.log(`\n=== whoop_body_measurements (${body.length}) ===`);
  for (const b of body) console.log(`  ${b.whoopUserId}`, b);

  const counts = async (label: string, table: PgTable) => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table);
    return `${label}: ${n}`;
  };
  console.log("\n=== row counts ===");
  console.log(" ", await counts("cycles      ", whoopCycles));
  console.log(" ", await counts("recoveries  ", whoopRecoveries));
  console.log(" ", await counts("sleeps      ", whoopSleeps));
  console.log(" ", await counts("workouts    ", whoopWorkouts));

  const events = await db
    .select()
    .from(whoopWebhookEvents)
    .orderBy(desc(whoopWebhookEvents.id))
    .limit(10);
  console.log(`\n=== last 10 whoop_webhook_events (${events.length}) ===`);
  for (const e of events) {
    const status = e.processedAt
      ? "ok"
      : e.processingError
        ? `error: ${e.processingError.slice(0, 60)}`
        : "pending";
    console.log(
      `  #${e.id}  ${e.type.padEnd(20)} ${e.resourceId.padEnd(38)} ${status}`,
    );
  }

  const recentSleeps = await db
    .select({
      id: whoopSleeps.id,
      start: whoopSleeps.start,
      perf: whoopSleeps.sleepPerformancePercentage,
      score: whoopSleeps.scoreState,
    })
    .from(whoopSleeps)
    .orderBy(desc(whoopSleeps.start))
    .limit(5);
  console.log(`\n=== last 5 sleeps ===`);
  for (const s of recentSleeps)
    console.log(`  ${s.start.toISOString()}  perf=${s.perf}  ${s.score}  ${s.id}`);

  const recentWorkouts = await db
    .select({
      id: whoopWorkouts.id,
      start: whoopWorkouts.start,
      sport: whoopWorkouts.sportName,
      strain: whoopWorkouts.strain,
    })
    .from(whoopWorkouts)
    .orderBy(desc(whoopWorkouts.start))
    .limit(5);
  console.log(`\n=== last 5 workouts ===`);
  for (const w of recentWorkouts)
    console.log(
      `  ${w.start.toISOString()}  ${w.sport.padEnd(20)} strain=${w.strain}  ${w.id}`,
    );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
