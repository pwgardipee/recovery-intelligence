import Link from "next/link";

export type AdminStayTab = "overview" | "history" | "insights";

const TABS: ReadonlyArray<{ key: AdminStayTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "history", label: "History" },
  { key: "insights", label: "Insights" },
];

/**
 * Server-rendered tab strip for the admin stay detail page. URL-driven
 * (`?tab=overview|history|insights`) so views stay shareable and the page
 * remains a pure server component — no client state needed.
 */
export function TabNav({
  stayId,
  current,
}: {
  stayId: number;
  current: AdminStayTab;
}) {
  return (
    <nav className="border-b border-line bg-paper/60">
      <div className="mx-auto flex max-w-[1100px] items-center gap-1 px-6">
        {TABS.map((t) => {
          const active = t.key === current;
          const href =
            t.key === "overview"
              ? `/admin/stays/${stayId}`
              : `/admin/stays/${stayId}?tab=${t.key}`;
          return (
            <Link
              key={t.key}
              href={href}
              className={`relative px-4 py-3 text-[11px] uppercase tracking-[0.22em] transition-colors ${
                active
                  ? "text-forest"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-[2px] bg-gold" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function parseTab(value: string | string[] | undefined): AdminStayTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "history" || raw === "insights") return raw;
  return "overview";
}
