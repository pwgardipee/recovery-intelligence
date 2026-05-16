import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/conversation/:id
 *
 * Proxies to ElevenLabs to fetch the full conversation by id — used by the
 * outbound-call UI to poll until the call completes and pull the transcript.
 *
 * Returns: { status, transcript[], audio_url?, metadata }
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
    `https://api.elevenlabs.io/v1/convai/conversations/${id}`,
    {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    },
  );

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: "elevenlabs_error", status: res.status, details: data },
      { status: res.status },
    );
  }

  // Normalise the shape so the client doesn't care about field-naming drift.
  const d = data as {
    status?: string;
    transcript?: Array<{ role?: string; message?: string; text?: string }>;
    has_audio?: boolean;
    metadata?: { call_duration_secs?: number };
  };

  const turns = (d.transcript ?? []).map((t) => ({
    who: t.role === "user" ? "guest" : "rose",
    line: t.message ?? t.text ?? "",
  }));

  return NextResponse.json({
    status: d.status ?? "unknown",
    transcript: turns,
    durationSec: d.metadata?.call_duration_secs ?? null,
    hasAudio: Boolean(d.has_audio),
    audioUrl: d.has_audio
      ? `/api/elevenlabs/conversation/${id}/audio`
      : null,
  });
}
