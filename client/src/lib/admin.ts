export type AdminCheckUser =
  | {
      role?: string | null;
      isAdmin?: boolean | null;
      email?: string | null;
      claims?: { email?: string | null; role?: string | null } | null;
    }
  | null
  | undefined;

export function isAdminUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  const DEFAULT_ADMIN_EMAIL = "carrerajorge874@gmail.com";

  // Some endpoints may hydrate an explicit boolean.
  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const email = String(anyUser.email ?? anyUser.claims?.email ?? "").toLowerCase().trim();
  if (email && email === DEFAULT_ADMIN_EMAIL) return true;

  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  if (role === "admin" || role === "superadmin") return true;
  return false;
}

export function isBillingManagerUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  const DEFAULT_ADMIN_EMAIL = "carrerajorge874@gmail.com";

  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const email = String(anyUser.email ?? anyUser.claims?.email ?? "").toLowerCase().trim();
  if (email && email === DEFAULT_ADMIN_EMAIL) return true;

  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return role === "admin" || role === "superadmin" || role === "team_admin";
}
