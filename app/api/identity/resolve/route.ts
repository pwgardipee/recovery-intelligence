import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  guests,
  memoryFacts,
  messages,
  stays,
} from "@/lib/db/rhythm-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/identity/resolve
 *
 * Demo Step 1 — "Recognize the guest." Pulls everything we know about
 * this guest from across all Rosewood properties and posts a single rich
 * identity card into the staff thread BEFORE the email goes out.
 *
 * Idempotent: if an identity_merge message already exists for this stay,
 * returns ok without duplicating.
 *
 * Body: { stayId: number }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { stayId: number };
  if (!body.stayId) {
    return NextResponse.json({ error: "stayId required" }, { status: 400 });
  }

  const [stay] = await db
    .select()
    .from(stays)
    .where(eq(stays.id, body.stayId))
    .limit(1);
  if (!stay) {
    return NextResponse.json({ error: "stay not found" }, { status: 404 });
  }

  const [guest] = await db
    .select()
    .from(guests)
    .where(eq(guests.id, stay.guestId))
    .limit(1);
  if (!guest) {
    return NextResponse.json({ error: "guest missing" }, { status: 500 });
  }

  // Idempotency: if we've already posted an identity_merge for this stay, no-op.
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.stayId, body.stayId),
        eq(messages.kind, "identity_merge"),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }

  // Pull every memory fact on file across her prior Rosewood stays.
  const facts = await db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.guestId, guest.id))
    .limit(20);

  // Decorate each fact with a source property if we can infer one from the
  // text. Real production system would join on source_stay_id → properties.
  const factsCarried = facts.map((f) => ({
    fact: f.fact,
    kind: f.kind,
    source: inferSource(f.fact),
    confidence: f.confidence,
  }));

  // Curated list of past properties for the merge card. For Tavishi specifically
  // we know the prior stays; for any other guest we list whatever facts hint at.
  const priorProperties = inferPriorProperties(
    guest.mergedProfileCount,
    facts.map((f) => f.fact),
  );

  await appendMessage(body.stayId, {
    author: "rose",
    authorRole: "ai",
    kind: "identity_merge",
    content: {
      headline: `${guest.name} — ${guest.mergedProfileCount} profile${
        guest.mergedProfileCount === 1 ? "" : "s"
      } unified across Rosewood properties.`,
      properties: priorProperties,
      factsCarried,
      summary:
        factsCarried.length > 0
          ? `Pulled ${factsCarried.length} preferences forward from her prior stays. Drafting the pre-arrival email now.`
          : "First Rosewood stay — no prior preferences on file. Drafting the pre-arrival email now.",
    },
  });

  await appendMessage(body.stayId, {
    author: "rose",
    authorRole: "ai",
    kind: "text",
    content: {
      line:
        factsCarried.length > 0
          ? `Before reaching out — I've folded everything we already know about her into context. The email will reference what's already on file.`
          : `New to Rosewood. Treating with extra care — the email is the first impression.`,
    },
  });

  revalidatePath(`/admin/stays/${body.stayId}`);
  revalidatePath(`/control/${body.stayId}`);

  return NextResponse.json({ ok: true, factCount: factsCarried.length });
}

function inferSource(fact: string): string | null {
  if (/Crillon|Paris/i.test(fact)) return "Hotel de Crillon, Paris";
  if (/Sand Hill|Menlo|oak grove/i.test(fact)) return "Rosewood Sand Hill";
  if (/Miramar|Montecito/i.test(fact)) return "Rosewood Miramar Beach";
  if (/Hong Kong/i.test(fact)) return "Rosewood Hong Kong";
  if (/Calistoga/i.test(fact)) return "Rosewood Calistoga";
  if (/Bangkok|Phuket|Amsterdam|Madrid/i.test(fact)) return "Rosewood global";
  return null;
}

function inferPriorProperties(count: number, facts: string[]): string[] {
  const found = new Set<string>();
  for (const f of facts) {
    const s = inferSource(f);
    if (s && s !== "Rosewood global") found.add(s);
  }
  // For Tavishi's specific demo: ensure these show up even if the seeded facts
  // don't mention every property.
  const defaults = ["Hotel de Crillon, Paris", "Rosewood Miramar Beach"];
  for (const d of defaults) {
    if (found.size >= count - 1) break;
    found.add(d);
  }
  return [...Array.from(found)].slice(0, Math.max(count - 1, 0));
}

async function appendMessage(
  stayId: number,
  msg: {
    author: string;
    authorRole: "ai" | "staff" | "guest";
    kind: string;
    content: Record<string, unknown>;
  },
) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${messages.sceneOrder}), 0) + 1` })
    .from(messages)
    .where(
      and(eq(messages.stayId, stayId), eq(messages.thread, "staff")),
    );

  await db.insert(messages).values({
    stayId,
    thread: "staff",
    author: msg.author,
    authorRole: msg.authorRole,
    kind: msg.kind,
    content: msg.content,
    approvalStatus: "auto",
    sceneOrder: next,
  });
}
