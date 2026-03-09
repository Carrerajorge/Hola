import {
  FORCE_SIGNED_OUT_STORAGE_KEY,
  clearForcedSignedOutFlag,
  hasLoggedOutMarker,
  hasOAuthSuccessMarker,
  isPublicAuthRoute,
  shouldSkipAnonymousIdentity,
} from "./auth-flow";

describe("auth-flow helpers", () => {
  it("recognizes public auth routes", () => {
    expect(isPublicAuthRoute("/")).toBe(true);
    expect(isPublicAuthRoute("/login")).toBe(true);
    expect(isPublicAuthRoute("/welcome")).toBe(true);
    expect(isPublicAuthRoute("/pricing/enterprise")).toBe(true);
    expect(isPublicAuthRoute("/settings")).toBe(false);
    expect(isPublicAuthRoute("/workspace/abc")).toBe(false);
  });

  it("detects auth query markers", () => {
    expect(hasLoggedOutMarker("?logged_out=1")).toBe(true);
    expect(hasLoggedOutMarker("logged_out=1")).toBe(true);
    expect(hasLoggedOutMarker("?logged_out=0")).toBe(false);
    expect(hasOAuthSuccessMarker("?auth=success")).toBe(true);
    expect(hasOAuthSuccessMarker("?auth=failed")).toBe(false);
  });

  it("skips anonymous identity on public and callback routes", () => {
    expect(shouldSkipAnonymousIdentity("/login", "", false)).toBe(true);
    expect(shouldSkipAnonymousIdentity("/", "?auth=success", false)).toBe(true);
    expect(shouldSkipAnonymousIdentity("/", "", false)).toBe(true);
    expect(shouldSkipAnonymousIdentity("/workspace/abc", "", false)).toBe(false);
    expect(shouldSkipAnonymousIdentity("/workspace/abc", "", true)).toBe(true);
  });

  it("clears the forced signed out flag", () => {
    const removeItem = vi.fn();
    clearForcedSignedOutFlag({ removeItem });
    expect(removeItem).toHaveBeenCalledWith(FORCE_SIGNED_OUT_STORAGE_KEY);
  });
});
