import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { messages } from "@/lib/db/rhythm-schema";
import { approveMessage } from "@/lib/rhythm/scenes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/messages/:id/approve
 *   body: { action: "approve" | "decline" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const { action } = (await req.json()) as { action: "approve" | "decline" };

  const [m] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "approve") {
    await approveMessage(messageId);
  } else {
    await db
      .update(messages)
      .set({ approvalStatus: "declined" })
      .where(eq(messages.id, messageId));
  }

  revalidatePath(`/admin/stays/${m.stayId}`);
  return NextResponse.json({ ok: true });
}
