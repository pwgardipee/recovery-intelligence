"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * One-click demo bootstrap. POSTs /api/seed (idempotent — wipes the previous
 * Maya demo state and creates a fresh stay), then routes to the admin
 * concierge thread so the demo starts in 1 click.
 */
export function BeginDemoButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function begin() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/seed", { method: "POST" });
        const body = (await res.json()) as
          | { sandHillStayId: number }
          | { error: string };
        if (!res.ok || !("sandHillStayId" in body)) {
          setError(
            "error" in body ? body.error : `seed failed (${res.status})`,
          );
          return;
        }
        router.push(`/admin/stays/${body.sandHillStayId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        onClick={begin}
        disabled={pending}
        className="group flex items-center gap-3 rounded-sm bg-forest px-6 py-3.5 text-[12px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep"
      >
        <span>
          {pending ? "Preparing the demo…" : "Begin the demo"}
        </span>
        <svg
          width="22"
          height="14"
          viewBox="0 0 22 14"
          fill="none"
          className="transition-transform group-hover:translate-x-1"
        >
          <path
            d="M1 7h19m0 0L14 1m6 6l-6 6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <p className="text-[11px] italic text-ink-muted">
        Seeds Maya, the demo guest, and opens the concierge thread. Safe to
        re-run between rehearsals.
      </p>
      {error && (
        <p className="rw-enter text-[12px] text-clay">
          Something snagged: {error}
        </p>
      )}
    </div>
  );
}
