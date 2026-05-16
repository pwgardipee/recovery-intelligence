"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface PropertyOption {
  slug: string;
  name: string;
  city: string;
}

/**
 * URL-driven property selector. Pushes ?property=<slug> on change,
 * preserving any other search params (e.g. phase filters on /admin/stays).
 * "all" removes the param entirely.
 */
export function PropertyPicker({
  properties,
  current,
  showAllOption = false,
}: {
  properties: PropertyOption[];
  current: string | null;
  showAllOption?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const handleChange = (value: string) => {
    const params = new URLSearchParams(search.toString());
    if (value === "all") {
      params.delete("property");
    } else {
      params.set("property", value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <label className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">
      <span>Location</span>
      <select
        value={current ?? "all"}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-sm border border-line bg-paper px-3 py-1.5 text-[12px] uppercase tracking-[0.18em] text-forest hover:border-gold focus:border-gold focus:outline-none"
      >
        {showAllOption && <option value="all">All locations</option>}
        {properties.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name} · {p.city}
          </option>
        ))}
      </select>
    </label>
  );
}
