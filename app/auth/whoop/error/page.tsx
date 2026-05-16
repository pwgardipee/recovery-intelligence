import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WHOOP connection failed | Recovery Intelligence",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  reason?: string | string[];
}>;

const REASON_MESSAGES: Record<string, string> = {
  missing_code_or_state:
    "WHOOP didn't return an authorization code. Please try connecting again.",
  state_mismatch:
    "The OAuth state cookie was missing or didn't match. This can happen if you took longer than 10 minutes to authorize, or your cookies are blocked. Please try again.",
  token_exchange_failed:
    "We couldn't exchange the WHOOP authorization code for an access token. The connection has not been saved.",
  profile_fetch_failed:
    "We received tokens from WHOOP but couldn't read your basic profile. Please try again.",
  access_denied:
    "You declined to grant access on the WHOOP authorization screen.",
};

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function WhoopErrorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const reason = first(params.reason) ?? "unknown";
  const message =
    REASON_MESSAGES[reason] ??
    "Something went wrong while connecting your WHOOP account.";

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-red-500"
          />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            WHOOP connection failed
          </h1>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {message}
        </p>

        <dl className="mt-6 rounded-lg bg-zinc-50 p-4 text-xs dark:bg-zinc-900">
          <dt className="font-medium text-zinc-500 dark:text-zinc-400">
            reason
          </dt>
          <dd className="break-all font-mono text-zinc-900 dark:text-zinc-100">
            {reason}
          </dd>
        </dl>

        <div className="mt-8 flex items-center justify-between text-sm">
          <Link
            href="/auth/whoop/start"
            className="font-medium text-zinc-950 hover:opacity-80 dark:text-zinc-50"
          >
            Try again →
          </Link>
          <Link
            href="/"
            className="font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Back to home
          </Link>
        </div>
      </main>
    </div>
  );
}
