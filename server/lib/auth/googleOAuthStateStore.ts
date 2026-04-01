/**
 * Helpers for identifying Google OAuth state-parameter failures.
 *
 * When the OAuth callback receives an invalid or missing `state` parameter the
 * Passport strategy surfaces an error whose message typically contains one of
 * the phrases below.  Detecting these allows the error-classification helper in
 * routes.ts to return the specific `google_state_failed` code so the client can
 * show a targeted retry prompt rather than a generic failure screen.
 */

const STATE_FAILURE_PATTERNS = [
  "state mismatch",
  "invalid state",
  "missing state",
  "csrf",
  "state parameter",
  "unable to verify authorization request state",
];

export function isGoogleOAuthStateFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return STATE_FAILURE_PATTERNS.some((pattern) => lower.includes(pattern));
}
