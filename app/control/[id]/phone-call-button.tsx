"use client";

import { useEffect, useRef, useState, useTransition } from "react";

interface TranscriptEntry {
  who: "rose" | "guest";
  line: string;
}

/**
 * Real phone call — Rose dials the guest's actual phone via ElevenLabs'
 * Twilio integration. The phone rings; on pickup the conversation happens
 * over the cellular network with the same dynamic variables the WebRTC
 * version uses.
 *
 * Requires env:
 *   ELEVENLABS_API_KEY
 *   NEXT_PUBLIC_ELEVENLABS_AGENT_ID
 *   ELEVENLABS_PHONE_NUMBER_ID  (a number you've imported in the EL dashboard)
 */
export function PhoneCallButton({
  stayId,
  defaultNumber,
  available,
  onCallComplete,
}: {
  stayId: number;
  defaultNumber: string;
  available: boolean;
  onCallComplete: () => void;
}) {
  const [toNumber, setToNumber] = useState(defaultNumber);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "dialing" | "live" | "done" | "error"
  >("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [savePending, startSave] = useTransition();
  const pollRef = useRef<number | null>(null);

  // Stop polling on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function placeCall() {
    setError(null);
    setErrorDetails(null);
    setTranscript([]);
    setAudioUrl(null);
    setStatus("dialing");
    try {
      const res = await fetch("/api/elevenlabs/outbound-call", {
        method: "POST",
        body: JSON.stringify({ stayId, toNumber }),
      });
      const data = (await res.json()) as {
        conversationId?: string;
        error?: string;
        details?: unknown;
      };
      if (!res.ok || !data.conversationId) {
        setError(data.error ?? `outbound call failed (${res.status})`);
        setErrorDetails(data.details ?? null);
        setStatus("error");
        return;
      }
      setConversationId(data.conversationId);
      setStatus("live");

      // Poll for status + transcript every 2.5s.
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await fetch(
            `/api/elevenlabs/conversation/${data.conversationId}`,
          );
          const c = (await r.json()) as {
            status?: string;
            transcript?: TranscriptEntry[];
            audioUrl?: string | null;
          };
          if (c.transcript) setTranscript(c.transcript);
          if (
            c.status === "done" ||
            c.status === "completed" ||
            c.status === "ended" ||
            c.status === "failed"
          ) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setAudioUrl(c.audioUrl ?? null);
            setStatus(c.status === "failed" ? "error" : "done");
          }
        } catch (err) {
          console.error("[phone-call] poll error", err);
        }
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
      setStatus("error");
    }
  }

  function endPolling() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    setStatus("done");
  }

  function saveAndAdvance() {
    if (transcript.length === 0) return;
    startSave(async () => {
      const transcriptText = transcript
        .map((t) => `${t.who === "rose" ? "Rose" : "Guest"}: ${t.line}`)
        .join("\n\n");
      await fetch("/api/intake/from-call", {
        method: "POST",
        body: JSON.stringify({
          stayId,
          transcript: transcriptText,
          source: "pre_call",
          audioUrl: audioUrl ?? "/audio/pre-arrival.mp3",
        }),
      });
      setTranscript([]);
      setStatus("idle");
      setConversationId(null);
      onCallComplete();
    });
  }

  if (!available) {
    return (
      <div className="rw-card border-amber/30 bg-amber/5 px-5 py-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-amber">
          Phone call · not yet configured
        </p>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">
          To enable real outbound phone calls, set in <code>.env.local</code>:
        </p>
        <ul className="mt-2 list-disc pl-5 text-[12.5px] leading-6 text-ink-soft">
          <li>
            <code>ELEVENLABS_API_KEY</code> — server-side key
          </li>
          <li>
            <code>ELEVENLABS_PHONE_NUMBER_ID</code> — id of a number you imported
            from Twilio in the ElevenLabs dashboard
          </li>
        </ul>
        <p className="mt-3 text-[11.5px] italic text-ink-muted">
          The browser WebRTC call works without these — use it for the safest
          demo path.
        </p>
      </div>
    );
  }

  return (
    <div className="rw-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line bg-paper px-5 py-4">
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold">
            Real phone call · via Twilio
          </p>
          <p className="font-serif mt-1 text-[15px] text-forest">
            Rose dials a real phone
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              to
            </span>
            <input
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              disabled={status !== "idle" && status !== "done" && status !== "error"}
              placeholder="+1 415 ..."
              className="w-44 border-b border-line bg-transparent py-1 text-[14px] text-forest focus:border-gold focus:outline-none"
            />
          </div>
        </div>

        <PhoneCallControl
          status={status}
          hasTranscript={transcript.length > 0}
          savePending={savePending}
          onPlace={placeCall}
          onEnd={endPolling}
          onSave={saveAndAdvance}
        />
      </div>

      {(status === "live" || status === "done" || status === "dialing") && (
        <div className="px-5 py-4">
          <StatusLine status={status} duration={transcript.length} />
          {transcript.length > 0 ? (
            <ul className="rw-scroll max-h-56 space-y-2 overflow-y-auto pr-2 text-[12.5px] leading-5">
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
              Transcript will stream here as the call progresses.
            </p>
          )}
          {audioUrl && (
            <audio controls src={audioUrl} className="mt-3 w-full" />
          )}
        </div>
      )}

      {error && (
        <div className="border-t border-clay/30 bg-clay/5 px-5 py-3 text-[12px] leading-5 text-clay">
          <p>{error}</p>
          {errorDetails !== null && errorDetails !== undefined && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10.5px] uppercase tracking-[0.2em] text-clay/70 hover:text-clay">
                ElevenLabs response
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-sm bg-paper/60 p-2 text-[11px] leading-5 text-ink-soft">
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PhoneCallControl({
  status,
  hasTranscript,
  savePending,
  onPlace,
  onEnd,
  onSave,
}: {
  status: "idle" | "dialing" | "live" | "done" | "error";
  hasTranscript: boolean;
  savePending: boolean;
  onPlace: () => void;
  onEnd: () => void;
  onSave: () => void;
}) {
  if (status === "done" && hasTranscript) {
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
  if (status === "live" || status === "dialing") {
    return (
      <button
        onClick={onEnd}
        className="rounded-sm border border-clay/40 bg-clay/5 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-clay"
      >
        Stop polling
      </button>
    );
  }
  return (
    <button
      onClick={onPlace}
      className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-cream hover:bg-forest-deep"
    >
      Call now →
    </button>
  );
}

function StatusLine({
  status,
  duration,
}: {
  status: "idle" | "dialing" | "live" | "done" | "error";
  duration: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-ink-muted">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          status === "live"
            ? "rw-pulse text-emerald bg-emerald"
            : status === "dialing"
              ? "bg-amber"
              : status === "done"
                ? "bg-ink-muted"
                : "bg-clay"
        }`}
      />
      {status === "dialing"
        ? "ringing…"
        : status === "live"
          ? `live · ${duration} turn${duration === 1 ? "" : "s"}`
          : status === "done"
            ? "call ended"
            : status}
    </div>
  );
}
