"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Spawn a brand-new demo guest from the control panel. Used for live audience
 * demos where the presenter wants to show the flow against a fresh name
 * (e.g. someone in the room volunteering) rather than the seeded Tavishi.
 */
export function NewGuestButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [returning, setReturning] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/guests/create", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim() || undefined,
            returning,
          }),
        });
        const data = (await res.json()) as {
          stayId?: number;
          error?: string;
        };
        if (!res.ok || !data.stayId) {
          setError(data.error ?? `create failed (${res.status})`);
          return;
        }
        router.push(`/control/${data.stayId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-sm border border-line bg-paper px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-ink-soft hover:border-gold hover:text-forest"
      >
        <span className="text-[14px] leading-none text-gold">+</span>
        New demo guest
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rw-enter rw-card flex w-full max-w-md flex-col gap-3 px-4 py-4 sm:absolute sm:right-0 sm:top-12 sm:z-10 sm:w-[420px]"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.32em] text-gold">
          New demo guest
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ink-muted hover:text-ink"
        >
          cancel
        </button>
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Name
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Tilly Park"
          className="mt-1 w-full border-b border-line bg-transparent py-1.5 text-[15px] leading-7 text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Phone (optional — for the day-before call)
        </span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 415 555 0123"
          className="mt-1 w-full border-b border-line bg-transparent py-1.5 text-[14px] text-forest placeholder:text-ink-muted focus:border-gold focus:outline-none"
        />
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-cream/40 px-3 py-2.5">
        <input
          type="checkbox"
          checked={returning}
          onChange={(e) => setReturning(e.target.checked)}
          className="mt-1 accent-forest"
        />
        <span>
          <span className="block text-[13px] font-medium text-forest">
            Returning Rosewood guest
          </span>
          <span className="block text-[11.5px] italic text-ink-muted">
            Seeds 4 preferences from prior Rosewood stays so Step 1 has
            something real to carry forward.
          </span>
        </span>
      </label>

      {error && (
        <p className="rw-enter text-[12px] text-clay">{error}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-sm bg-forest px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-cream hover:bg-forest-deep disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create & open →"}
        </button>
      </div>
    </form>
  );
}
