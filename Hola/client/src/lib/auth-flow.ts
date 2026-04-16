/**
 * Auth flow utilities for managing authentication state flags.
 */

const FORCE_SIGNED_OUT_KEY = "siragpt_force_signed_out";

const PUBLIC_AUTH_ROUTES = [
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
];

/**
 * Clears the forced-signed-out flag set when a user is forcibly logged out.
 * Called before initiating a new login flow so the user won't be immediately
 * bounced back to /login after authenticating.
 */
export function clearForcedSignedOutFlag(): void {
  try {
    localStorage.removeItem(FORCE_SIGNED_OUT_KEY);
  } catch {
    // localStorage may be unavailable (e.g. incognito mode quota exceeded)
  }
}

/**
 * Sets the forced-signed-out flag (used by auth context to redirect non-public routes).
 */
export function setForcedSignedOutFlag(): void {
  try {
    localStorage.setItem(FORCE_SIGNED_OUT_KEY, "1");
  } catch {
    // Ignore
  }
}

/**
 * Returns true if the current path is a public auth route (no login required).
 */
export function isPublicAuthRoute(pathname?: string): boolean {
  const p = pathname || (typeof window !== "undefined" ? window.location.pathname : "/");
  if (p === "/") return true;
  return PUBLIC_AUTH_ROUTES.some((route) => p.startsWith(route));
}

/**
 * Returns true if the current URL contains the OAuth success marker (?auth=success).
 */
export function hasOAuthSuccessMarker(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("auth") === "success";
}

/**
 * Returns true if we should defer the authenticated bootstrap
 * (e.g. while waiting for an OAuth callback to resolve).
 */
export function shouldDeferAuthenticatedBootstrap(): boolean {
  return hasOAuthSuccessMarker();
}
