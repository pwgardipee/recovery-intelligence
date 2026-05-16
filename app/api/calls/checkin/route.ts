import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { runCheckin, runPostStayCheckin } from "@/lib/rhythm/checkins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/calls/checkin
 *
 * Drives the on-trip / post-trip "Rose calls the guest" beats from the
 * control panel. Body:
 *
 *   { stayId: number, kind: "morning" | "evening" | "post_stay" }
 *
 * Persists a voice_call card, a daily_rhythm OR trip_wrap card, and
 * (post-stay) a memory_write + memory_facts row. Re-rendered admin pages
 * pick everything up via revalidatePath below.
 */
export async function POST(req: NextRequest) {
  let body: { stayId?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const stayId = Number(body.stayId);
  if (!Number.isFinite(stayId) || stayId <= 0) {
    return NextResponse.json({ error: "stayId required" }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "morning" && kind !== "evening" && kind !== "post_stay") {
    return NextResponse.json(
      { error: "kind must be morning, evening, or post_stay" },
      { status: 400 },
    );
  }

  try {
    const result =
      kind === "post_stay"
        ? await runPostStayCheckin(stayId)
        : await runCheckin(stayId, kind);

    revalidatePath(`/admin/stays/${stayId}`);
    revalidatePath(`/control/${stayId}`);

    return NextResponse.json({ ok: true, kind, result: result.result });
  } catch (err) {
    console.error("[/api/calls/checkin]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "check-in failed",
      },
      { status: 500 },
    );
  }
}
