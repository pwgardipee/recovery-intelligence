import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WHOOP connected | Recovery Intelligence",
  robots: { index: false, follow: false },
};

export default function WhoopConnectedPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
          />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            WHOOP connected
          </h1>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Your WHOOP account is linked. We&rsquo;re pulling your last 30 days
          of cycles, sleeps, workouts, and recoveries in the background — this
          usually finishes within a minute. New data will sync automatically
          via webhooks from now on.
        </p>

        <div className="mt-8 flex items-center justify-between text-sm">
          <Link
            href="/"
            className="font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Back to home
          </Link>
          <Link
            href="/privacy"
            className="font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Privacy policy
          </Link>
        </div>
      </main>
    </div>
  );
}
