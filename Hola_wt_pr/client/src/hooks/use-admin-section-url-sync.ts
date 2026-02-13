import { useEffect } from "react";

type NavigateFn = (to: string, options?: { replace?: boolean; state?: any; transition?: boolean }) => void;

export function parseAdminSectionQuery<TKeys extends string>(
  location: string,
  section: string,
  filterKeys: readonly TKeys[]
): { page: number; filters: Record<TKeys, string> } {
  const params = new URLSearchParams(location.split("?")[1] || "");
  const isSection = params.get("section") === section;

  const pageRaw = Number.parseInt(String((isSection ? params.get("page") : null) || "1"), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const filters = {} as Record<TKeys, string>;
  for (const key of filterKeys) {
    filters[key] = isSection ? String(params.get(key) || "") : "";
  }
  return { page, filters };
}

export function useAdminSectionUrlSync<TFilters extends Record<string, string>>(opts: {
  section: string;
  location: string;
  setLocation: NavigateFn;
  page: number;
  setPage: (next: number | ((prev: number) => number)) => void;
  filters: TFilters;
  setFilters: (next: TFilters | ((prev: TFilters) => TFilters)) => void;
  filterKeys: readonly (keyof TFilters & string)[];
}) {
  const { section, location, setLocation, page, setPage, filters, setFilters, filterKeys } = opts;

  const keysSig = filterKeys.join("|");
  const valuesSig = filterKeys.map((k) => `${k}:${filters[k] || ""}`).join("|");

  // Read URL -> state (back/forward navigation).
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] || "");
    if (params.get("section") !== section) return;

    const nextPageRaw = Number.parseInt(params.get("page") || "1", 10);
    const nextPage = Number.isFinite(nextPageRaw) && nextPageRaw > 0 ? nextPageRaw : 1;
    setPage((prev) => (prev === nextPage ? prev : nextPage));

    setFilters((prev) => {
      let changed = false;
      const next = { ...prev } as TFilters;
      for (const key of filterKeys) {
        const v = String(params.get(key) || "");
        if (next[key] !== v) {
          next[key] = v as any;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location, section, keysSig, setPage, setFilters, filterKeys]);

  // Write state -> URL (deep-link + refresh persistence).
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] || "");
    if (params.get("section") !== section) return;

    const next = new URLSearchParams();
    next.set("section", section);
    for (const key of filterKeys) {
      const value = String(filters[key] || "").trim();
      if (value) next.set(key, value);
    }
    if (page !== 1) next.set("page", String(page));

    const nextUrl = `/admin?${next.toString()}`;
    if (location !== nextUrl) {
      setLocation(nextUrl, { replace: true });
    }
  }, [section, location, setLocation, page, keysSig, valuesSig, filterKeys, filters]);
}

