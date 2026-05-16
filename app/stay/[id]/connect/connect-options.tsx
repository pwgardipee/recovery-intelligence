"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Source {
  key: "whoop" | "apple" | "oura" | "garmin" | "fitbit" | "conversational";
  name: string;
  tagline: string;
  available: boolean;
  variant: "primary" | "muted" | "conversational";
}

const SOURCES: Source[] = [
  {
    key: "whoop",
    name: "Whoop",
    tagline: "Connect your account — recovery, sleep, strain",
    available: true,
    variant: "primary",
  },
  {
    key: "apple",
    name: "Apple Health",
    tagline: "Coming soon",
    available: false,
    variant: "muted",
  },
  {
    key: "oura",
    name: "Oura",
    tagline: "Coming soon",
    available: false,
    variant: "muted",
  },
  {
    key: "garmin",
    name: "Garmin",
    tagline: "Coming soon",
    available: false,
    variant: "muted",
  },
  {
    key: "fitbit",
    name: "Fitbit",
    tagline: "Coming soon",
    available: false,
    variant: "muted",
  },
  {
    key: "conversational",
    name: "Talk to us instead",
    tagline: "A short call or text exchange — no device required",
    available: true,
    variant: "conversational",
  },
];

export function ConnectOptions({
  stayId,
  firstName,
  propertyName,
}: {
  stayId: number;
  firstName: string;
  propertyName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [connected, setConnected] = useState<string | null>(null);

  function handleConnect(source: Source) {
    if (!source.available) return;
    startTransition(async () => {
      // Advance the demo to Scene 2 (consent + signals).
      await fetch("/api/scene", {
        method: "POST",
        body: JSON.stringify({ stayId, action: "jump", target: 2 }),
      });
      setConnected(source.name);
      // Refresh the admin view in the background.
      router.refresh();
    });
  }

  if (connected) {
    return (
      <div className="rw-enter mt-6 rounded-sm border border-line bg-paper p-8">
        <div className="flex items-start gap-4">
          <span className="text-emerald rw-pulse mt-2 inline-block h-2 w-2 rounded-full" />
          <div>
            <p className="text-[0.625rem] uppercase tracking-[0.32em] text-emerald">
              {connected} connected
            </p>
            <h2 className="font-serif mt-3 text-2xl leading-snug text-forest">
              Thank you, {firstName}.
            </h2>
            <p className="mt-3 text-[14px] leading-6 text-ink-soft">
              {propertyName} will translate the signal into the pacing of your
              stay — never the number itself. Rose will be in touch the
              evening before your arrival.
            </p>
            <p className="mt-4 text-[12px] text-ink-muted">
              Auto-disconnects at checkout. You can stop at any time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rw-stagger mt-6 space-y-3">
      {SOURCES.map((source) => (
        <button
          key={source.key}
          onClick={() => handleConnect(source)}
          disabled={!source.available || pending}
          className={cardClasses(source)}
        >
          <div className="flex flex-1 items-center justify-between gap-6">
            <div className="text-left">
              <div className="flex items-center gap-3">
                <span
                  className={
                    source.variant === "conversational"
                      ? "font-serif text-xl text-forest"
                      : "text-base font-medium text-forest"
                  }
                >
                  {source.name}
                </span>
                {source.variant === "primary" && (
                  <span className="rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald">
                    Available
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-ink-muted">
                {source.tagline}
              </p>
            </div>
            <Arrow muted={!source.available} />
          </div>
        </button>
      ))}

      {pending && (
        <p className="mt-3 text-[12px] italic text-ink-muted">
          A quiet moment while we connect…
        </p>
      )}
    </div>
  );
}

function cardClasses(source: Source) {
  const base =
    "group flex w-full items-center rounded-sm border px-5 py-5 text-left transition-all";
  if (source.variant === "primary") {
    return `${base} border-line bg-paper hover:border-gold hover:shadow-md`;
  }
  if (source.variant === "conversational") {
    return `${base} border-line bg-cream hover:border-gold`;
  }
  return `${base} border-line-soft bg-paper/50 opacity-60 cursor-not-allowed`;
}

function Arrow({ muted }: { muted: boolean }) {
  return (
    <svg
      width="20"
      height="14"
      viewBox="0 0 20 14"
      fill="none"
      className={
        muted
          ? "text-ink-muted"
          : "text-gold transition-transform group-hover:translate-x-1"
      }
    >
      <path
        d="M1 7h17m0 0L12 1m6 6l-6 6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
