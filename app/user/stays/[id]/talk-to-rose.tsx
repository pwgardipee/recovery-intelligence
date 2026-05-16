"use client";

import { useConversation } from "@elevenlabs/react";
import { useRef, useState, useTransition } from "react";

/**
 * Guest-side "Talk to Rose instead" — same ElevenLabs voice path as the
 * presenter's call, but framed as a conversation the guest initiates.
 * When done, the transcript flows into the same /api/intake/from-call
 * pipeline that the typed form uses.
 */

interface TranscriptEntry {
  who: "rose" | "guest";
  line: string;
}

export function TalkToRose({
  stayId,
  agentId,
  guestName,
  guestPhone: _guestPhone,
  onCallComplete,
}: {
  stayId: number;
  agentId: string | null;
  guestName: string;
  guestPhone: string;
  onCallComplete: () => void;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [done, setDone] = useState(false);
  const [savePending, startSave] = useTransition();
  const startTimeRef = useRef(0);

  const conversation = useConversation({
    onConnect: () => {
      startTimeRef.current = Date.now();
    },
    onDisconnect: () => setDone(true),
    onError: (err: unknown) => console.error("[talk-to-rose]", err),
    onMessage: (msg: unknown) => {
      const m = msg as { source?: string; message?: string; text?: string };
      const line = m.message ?? m.text ?? "";
      if (!line) return;
      const who: "rose" | "guest" = m.source === "user" ? "guest" : "rose";
      setTranscript((prev) => [...prev, { who, line }]);
    },
  });

  const status = conversation.status as
    | "connected"
    | "connecting"
    | "disconnected";

  async function start() {
    if (!agentId) return;
    setTranscript([]);
    setDone(false);
    try {
      await conversation.startSession({ agentId, connectionType: "webrtc" });
    } catch (err) {
      console.error("[talk-to-rose] failed", err);
    }
  }
  async function end() {
    await conversation.endSession();
    setDone(true);
  }
  function save() {
    if (transcript.length === 0) return;
    startSave(async () => {
      const transcriptText = transcript
        .map((t) => `${t.who === "rose" ? "Rose" : guestName}: ${t.line}`)
        .join("\n\n");
      await fetch("/api/intake/from-call", {
        method: "POST",
        body: JSON.stringify({
          stayId,
          transcript: transcriptText,
          duration: Math.round((Date.now() - startTimeRef.current) / 1000),
          source: "in_app_chat",
        }),
      });
      onCallComplete();
    });
  }

  if (!agentId) {
    return (
      <div className="rounded-sm border border-amber/30 bg-amber/5 px-5 py-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-amber">
          Voice not yet configured
        </p>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">
          For the live voice option, set{" "}
          <code>NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> in <code>.env.local</code>.
          The form below works fully without it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-gold/40 bg-paper p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-gold">
            Voice with Rose
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {status === "connected"
              ? conversation.isSpeaking
                ? "Rose is speaking…"
                : "Rose is listening"
              : status === "connecting"
                ? "Connecting…"
                : done
                  ? "Call ended"
                  : "Tap below to start. Your browser will ask for the mic."}
          </p>
        </div>

        {done && transcript.length > 0 ? (
          <button
            onClick={save}
            disabled={savePending}
            className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-cream hover:bg-forest-deep"
          >
            {savePending ? "Sending…" : "Send to Rosewood →"}
          </button>
        ) : status === "connected" || status === "connecting" ? (
          <button
            onClick={end}
            className="rounded-sm border border-clay/40 bg-clay/5 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-clay"
          >
            End
          </button>
        ) : (
          <button
            onClick={start}
            className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-cream hover:bg-forest-deep"
          >
            Start
          </button>
        )}
      </div>

      {transcript.length > 0 && (
        <ul className="rw-scroll mt-4 max-h-40 space-y-2 overflow-y-auto pr-1 text-[12.5px] leading-5">
          {transcript.map((t, i) => (
            <li
              key={i}
              className="rw-enter flex gap-3"
              style={{ animationDelay: `${Math.min(i, 5) * 60}ms` }}
            >
              <span
                className={`shrink-0 text-[10px] uppercase tracking-[0.2em] ${
                  t.who === "rose" ? "text-gold" : "text-ink-muted"
                }`}
                style={{ width: 52 }}
              >
                {t.who}
              </span>
              <span className="text-ink-soft">{t.line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
