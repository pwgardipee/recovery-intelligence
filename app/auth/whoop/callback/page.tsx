import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connecting WHOOP… | Recovery Intelligence",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  code?: string | string[];
  state?: string | string[];
  error?: string | string[];
  error_description?: string | string[];
  scope?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function WhoopOAuthCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const code = first(params.code);
  const state = first(params.state);
  const error = first(params.error);
  const errorDescription = first(params.error_description);

  // TODO: When the rest of the auth flow is wired up:
  //   1. Validate `state` against the value stored when the auth request was
  //      initiated (CSRF protection).
  //   2. POST `code` to https://api.prod.whoop.com/oauth/oauth2/token with
  //      grant_type=authorization_code, the redirect_uri, and the client
  //      credentials to exchange it for an access + refresh token.
  //   3. Persist the tokens (encrypted) against the guest's record and
  //      redirect to the concierge dashboard.
  const isError = Boolean(error);
  const isSuccess = !isError && Boolean(code);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              isError
                ? "bg-red-500"
                : isSuccess
                  ? "bg-emerald-500"
                  : "bg-amber-500"
            }`}
          />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {isError
              ? "WHOOP connection failed"
              : isSuccess
                ? "WHOOP connected"
                : "Awaiting WHOOP response"}
          </h1>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {isError
            ? "WHOOP returned an error while authorizing your account. You can close this window and try again."
            : isSuccess
              ? "Thanks — WHOOP sent us back an authorization code. We're finishing the connection so your hotel can tailor your stay."
              : "This page receives the redirect from WHOOP after you authorize Recovery Intelligence. Open it via the WHOOP login flow."}
        </p>

        {(isError || isSuccess) && (
          <dl className="mt-6 space-y-3 rounded-lg bg-zinc-50 p-4 text-xs dark:bg-zinc-900">
            {isError && (
              <>
                <div>
                  <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                    error
                  </dt>
                  <dd className="break-all font-mono text-zinc-900 dark:text-zinc-100">
                    {error}
                  </dd>
                </div>
                {errorDescription && (
                  <div>
                    <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                      description
                    </dt>
                    <dd className="break-all font-mono text-zinc-900 dark:text-zinc-100">
                      {errorDescription}
                    </dd>
                  </div>
                )}
              </>
            )}
            {isSuccess && (
              <>
                <div>
                  <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                    code
                  </dt>
                  <dd className="break-all font-mono text-zinc-900 dark:text-zinc-100">
                    {code!.slice(0, 8)}…{code!.slice(-4)}
                  </dd>
                </div>
                {state && (
                  <div>
                    <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                      state
                    </dt>
                    <dd className="break-all font-mono text-zinc-900 dark:text-zinc-100">
                      {state}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
        )}

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
