export type UpsertUserPayload = {
  id: string;
  email?: string | null;
  username?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
  authProvider?: string | null;
  emailVerified?: string | null;
  providerSubject?: string | null;
};

export type NormalizedUpsertUserPayload = {
  id: string;
  email: string | null;
  username: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string | null;
  authProvider: string | null;
  emailVerified: string | null;
  providerSubject: string;
};

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeUpsertUserPayload(
  payload: UpsertUserPayload,
): NormalizedUpsertUserPayload {
  const email = normalizeText(payload.email);
  const firstName = normalizeText(payload.firstName);
  const lastName = normalizeText(payload.lastName);
  const suppliedFullName = normalizeText(payload.fullName);
  const derivedFullName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  return {
    id: payload.id,
    email,
    username: normalizeText(payload.username),
    fullName: suppliedFullName ?? derivedFullName,
    firstName,
    lastName,
    profileImageUrl: normalizeText(payload.profileImageUrl),
    role: normalizeText(payload.role),
    authProvider: normalizeText(payload.authProvider),
    emailVerified: normalizeText(payload.emailVerified),
    providerSubject: normalizeText(payload.providerSubject) ?? payload.id,
  };
}
