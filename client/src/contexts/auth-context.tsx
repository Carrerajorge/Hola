// Backward-compatible shim.
// The live auth implementation moved to hooks/use-auth; keep this path stable
// for any lingering imports while avoiding duplicated auth logic.
export * from "../hooks/use-auth";
