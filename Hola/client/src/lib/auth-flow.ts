/**
 * Auth-flow utilities shared between login page and auth context.
 */

const FORCE_SIGNED_OUT_KEY = "siragpt_force_signed_out";

/**
 * Clears the forced-signed-out flag so that the auth hook
 * will allow fetching the user session again.
 */
export function clearForcedSignedOutFlag(): void {
  try {
    localStorage.removeItem(FORCE_SIGNED_OUT_KEY);
  } catch {
    // localStorage might be unavailable (private browsing).
  }
}

/**
 * Sets the forced-signed-out flag. The auth hook will skip
 * session fetching while this flag is set.
 */
export function setForcedSignedOutFlag(): void {
  try {
    localStorage.setItem(FORCE_SIGNED_OUT_KEY, "1");
  } catch {
    // Ignore.
  }
}

/**
 * Returns true when the user has been forcibly signed out.
 */
export function isForcedSignedOut(): boolean {
  try {
    return localStorage.getItem(FORCE_SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}
