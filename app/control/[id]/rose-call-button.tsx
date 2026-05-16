"use client";

import {
  ConversationProvider,
  useConversation,
} from "@elevenlabs/react";
import { useRef, useState, useTransition } from "react";

/**
 * Live pre-arrival call. Uses ElevenLabs Conversational AI via WebRTC in the
 * browser — no phone number, no Twilio. The presenter clicks start, the
 * browser opens a mic-permission prompt, the agent calls and converses. When
 * the call ends, we POST the transcript to /api/intake/from-call which runs
 * interpretIntake() and saves a real intake record, then advances the scene.
 *
 * The ElevenLabs SDK requires a ConversationProvider around any consumer of
 * useConversation, so we split the component in two: the outer wrapper that
 * provides context, and the inner body that uses the hook.
 */

interface Props {
  stayId: number;
  agentId: string | null;
  guestName: string;
  guestPhone: string;
  onCallComplete: () => void;
}

interface TranscriptEntry {
  who: "rose" | "maya";
  line: string;
  at: number;
}

export function RoseCallButton(props: Props) {
  if (!props.agentId) {
    return <NotConfigured />;
  }
  return (
    <ConversationProvider>
      <RoseCallButtonInner {...props} />
    </ConversationProvider>
  );
}

function RoseCallButtonInner({
  stayId,
  agentId,
  guestName,
  guestPhone,
  onCallComplete,
}: Props) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [done, setDone] = useState(false);
  const [savePending, startSave] = useTransition();
  const startTimeRef = useRef(0);

  const conversation = useConversation({
    onConnect: () => {
      startTimeRef.current = Date.now();
    },
    onDisconnect: () => {
      setDone(true);
    },
    onError: (err: unknown) => {
      console.error("[rose-call]", err);
    },
    onMessage: (msg: unknown) => {
      const m = msg as { source?: string; message?: string; text?: string };
      const line = m.message ?? m.text ?? "";
      if (!line) return;
      const who: "rose" | "maya" = m.source === "user" ? "maya" : "rose";
      setTranscript((prev) => [...prev, { who, line, at: Date.now() }]);
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
      // Fetch the dynamic variables for this stay so Rose walks in already
      // knowing her name, flight, occasion, companion, past preferences, etc.
      const res = await fetch(`/api/elevenlabs/context/${stayId}`);
      const data = (await res.json()) as { variables?: Record<string, string> };
      conversation.startSession({
        agentId,
        connectionType: "webrtc",
        dynamicVariables: data.variables ?? {},
      });
    } catch (err) {
      console.error("[rose-call] failed to start", err);
    }
  }

  function end() {
    conversation.endSession();
    setDone(true);
  }

  function saveAndAdvance() {
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
          source: "pre_call",
        }),
      });
      setTranscript([]);
      setDone(false);
      onCallComplete();
    });
  }

  return (
    <div className="rw-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-paper px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
            Live pre-arrival call
          </p>
          <p className="font-serif mt-1 text-[15px] text-forest">
            Rose → {guestName}
          </p>
          <p className="text-[11.5px] text-ink-muted">{guestPhone}</p>
        </div>
        <CallButton
          status={status}
          done={done}
          onStart={start}
          onEnd={end}
          onSave={saveAndAdvance}
          savePending={savePending}
          hasTranscript={transcript.length > 0}
        />
      </div>

      {(status !== "disconnected" || transcript.length > 0) && (
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status === "connected"
                  ? "rw-pulse text-emerald bg-emerald"
                  : status === "connecting"
                    ? "bg-amber"
                    : "bg-ink-muted"
              }`}
            />
            {status === "connected"
              ? conversation.isSpeaking
                ? "Rose is speaking"
                : "listening"
              : status === "connecting"
                ? "connecting…"
                : "call ended"}
          </div>

          {transcript.length > 0 ? (
            <ul className="rw-scroll max-h-48 space-y-2 overflow-y-auto pr-2 text-[12.5px] leading-5">
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
                    style={{ width: 56 }}
                  >
                    {t.who}
                  </span>
                  <span className="text-ink-soft">{t.line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] italic text-ink-muted">
              Transcript will appear here as you speak.
            </p>
          )}
        </div>
      )}

      {done && transcript.length > 0 && (
        <div className="rw-enter border-t border-line bg-cream/40 px-5 py-3 text-[12px] leading-5 text-ink-soft">
          Call ended. Save the transcript to the stay — Rose will extract the
          intake, post the call card in the staff thread, and advance the
          scene.
        </div>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="rw-card border-amber/30 bg-amber/5 px-5 py-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-amber">
        Live call · not yet configured
      </p>
      <p className="mt-2 text-[13px] leading-6 text-ink-soft">
        Create an agent at{" "}
        <a
          href="https://elevenlabs.io/app/agents"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:text-ink"
        >
          elevenlabs.io/app/agents
        </a>{" "}
        (system prompt: the four intake questions; voice: Charlotte). Set{" "}
        <code>NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> in <code>.env.local</code>{" "}
        and restart. The scripted scene 3 still plays without this.
      </p>
    </div>
  );
}

function CallButton({
  status,
  done,
  onStart,
  onEnd,
  onSave,
  savePending,
  hasTranscript,
}: {
  status: "connected" | "connecting" | "disconnected";
  done: boolean;
  onStart: () => void;
  onEnd: () => void;
  onSave: () => void;
  savePending: boolean;
  hasTranscript: boolean;
}) {
  if (done && hasTranscript) {
    return (
      <button
        onClick={onSave}
        disabled={savePending}
        className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-cream hover:bg-forest-deep"
      >
        {savePending ? "Saving…" : "Save to stay →"}
      </button>
    );
  }
  if (status === "connected" || status === "connecting") {
    return (
      <button
        onClick={onEnd}
        className="rounded-sm border border-clay/40 bg-clay/5 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-clay hover:bg-clay hover:text-paper"
      >
        End call
      </button>
    );
  }
  return (
    <button
      onClick={onStart}
      className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-cream hover:bg-forest-deep"
    >
      Place call →
    </button>
  );
}
