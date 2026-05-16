import "./_env";

import { eq, isNull, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { consentRecords } from "../lib/db/rhythm-schema";

/**
 * One-off backfill: derive rw_consent_records.whoop_user_id from the legacy
 * notes string ("Real Whoop OAuth · user_id 123456") for any rows that
 * pre-date the new column. Safe to run repeatedly — it only touches rows
 * where whoop_user_id is NULL.
 *
 * Run with:  npx tsx scripts/backfill-whoop-user-id.ts
 *
 * For prod, run the SQL directly against Neon (printed below) — Vercel won't
 * execute this script.
 */
async function main() {
  console.log("Searching for whoop consent rows missing whoop_user_id...");

  const rows = await db
    .select()
    .from(consentRecords)
    .where(isNull(consentRecords.whoopUserId));

  let updated = 0;
  for (const row of rows) {
    if (row.source !== "whoop" || !row.notes) continue;
    const m = row.notes.match(/user_id\s+(\d+)/);
    if (!m) {
      console.log(`  · row ${row.id} — no user_id in notes, skipping`);
      continue;
    }
    const whoopUserId = Number(m[1]);
    if (!Number.isFinite(whoopUserId)) continue;

    await db
      .update(consentRecords)
      .set({ whoopUserId })
      .where(eq(consentRecords.id, row.id));
    console.log(`  ✓ row ${row.id} stay=${row.stayId} → ${whoopUserId}`);
    updated += 1;
  }

  console.log(`\nDone. Updated ${updated} of ${rows.length} candidate row(s).`);
  console.log(
    "\nFor prod, the equivalent SQL is:\n" +
      "  UPDATE rw_consent_records\n" +
      "  SET whoop_user_id = SUBSTRING(notes FROM 'user_id\\s+(\\d+)')::bigint\n" +
      "  WHERE source = 'whoop' AND whoop_user_id IS NULL\n" +
      "    AND notes ~ 'user_id\\s+\\d+';",
  );

  // Reference sql() so the import isn't dropped in the no-op path.
  void sql;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
