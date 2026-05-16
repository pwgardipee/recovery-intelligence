import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/conversation/:id/audio
 *
 * Proxies the recorded call audio back to the browser as MP3. Used by the
 * voice_call card to let staff listen to the actual recording of the call.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY missing" },
      { status: 500 },
    );
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${id}/audio`,
    {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: "elevenlabs_audio_error", status: res.status, body: t },
      { status: res.status },
    );
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=3600",
    },
  });
}
