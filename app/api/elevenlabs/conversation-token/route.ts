import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/conversation-token?agentId=...
 *
 * Server-side fetch of an ElevenLabs WebRTC conversation token. Required
 * because the @elevenlabs/react SDK's browser-side token fetch only works
 * for *public* agents — private agents (the default, and what you must use
 * if you want Twilio outbound calling) reject the unauthenticated request
 * with 401, and `useConversation.startSession({ agentId })` then throws
 *
 *   "Your agent has authentication enabled, but no signed URL or
 *    conversation token was provided."
 *
 * This route mints the token using the server-side ELEVENLABS_API_KEY and
 * hands it back to the browser, which then calls
 * `startSession({ conversationToken })`.
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const url = new URL(req.url);
  const agentId =
    url.searchParams.get("agentId") ??
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server" },
      { status: 500 },
    );
  }
  if (!agentId) {
    return NextResponse.json(
      {
        error:
          "agentId is required (pass ?agentId=... or set NEXT_PUBLIC_ELEVENLABS_AGENT_ID)",
      },
      { status: 400 },
    );
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(
      agentId,
    )}`,
    {
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const text = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!upstream.ok) {
    console.error(
      "[conversation-token] ElevenLabs returned",
      upstream.status,
      body,
    );
    const elError = body as { detail?: { message?: string }; message?: string };
    return NextResponse.json(
      {
        error:
          elError.detail?.message ??
          elError.message ??
          `ElevenLabs returned ${upstream.status}`,
        details: body,
      },
      { status: upstream.status },
    );
  }

  const token = (body as { token?: string }).token;
  if (!token) {
    return NextResponse.json(
      { error: "ElevenLabs response missing token", details: body },
      { status: 502 },
    );
  }

  return NextResponse.json({ token });
}
