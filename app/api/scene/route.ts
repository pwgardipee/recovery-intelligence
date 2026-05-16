import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { advanceScene, jumpToScene, resetStay } from "@/lib/rhythm/scenes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scene
 *   body: { stayId, action: "advance" | "reset" | "jump", target?: number }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    stayId: number;
    action: "advance" | "reset" | "jump";
    target?: number;
  };

  if (!body.stayId || !body.action) {
    return NextResponse.json({ error: "missing stayId or action" }, { status: 400 });
  }

  try {
    if (body.action === "advance") {
      const result = await advanceScene(body.stayId);
      revalidatePath(`/admin/stays/${body.stayId}`);
      revalidatePath(`/`);
      return NextResponse.json(result);
    }
    if (body.action === "reset") {
      await resetStay(body.stayId);
      revalidatePath(`/admin/stays/${body.stayId}`);
      revalidatePath(`/`);
      return NextResponse.json({ scene: 0 });
    }
    if (body.action === "jump") {
      if (typeof body.target !== "number") {
        return NextResponse.json({ error: "target required" }, { status: 400 });
      }
      await jumpToScene(body.stayId, body.target);
      revalidatePath(`/admin/stays/${body.stayId}`);
      revalidatePath(`/`);
      return NextResponse.json({ scene: body.target });
    }
  } catch (err) {
    console.error("[scene] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
