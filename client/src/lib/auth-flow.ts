const PUBLIC_AUTH_ROUTES = Object.freeze([
  "/",
  "/login",
  "/welcome",
  "/signup",
  "/terms",
  "/privacy-policy",
  "/about",
  "/learn",
  "/pricing",
  "/business",
  "/download",
  "/power",
  "/openclaw",
]);

export const FORCE_SIGNED_OUT_STORAGE_KEY = "siragpt_force_signed_out";

function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function getSearchParams(search: string): URLSearchParams {
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(normalized);
}

export function isPublicAuthRoute(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return PUBLIC_AUTH_ROUTES.some((route) => normalized === route || normalized.startsWith(`${route}/`));
}

export function hasLoggedOutMarker(search: string): boolean {
  return getSearchParams(search).get("logged_out") === "1";
}

export function hasOAuthSuccessMarker(search: string): boolean {
  return getSearchParams(search).get("auth") === "success";
}

export function shouldSkipAnonymousIdentity(
  pathname: string,
  search: string,
  forcedSignedOut: boolean,
): boolean {
  return (
    forcedSignedOut ||
    hasLoggedOutMarker(search) ||
    hasOAuthSuccessMarker(search) ||
    isPublicAuthRoute(pathname)
  );
}

export function clearForcedSignedOutFlag(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(FORCE_SIGNED_OUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
