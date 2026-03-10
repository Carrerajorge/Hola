export type AdminCheckUser =
  | {
      role?: string | null;
      isAdmin?: boolean | null;
      email?: string | null;
      claims?: { email?: string | null; role?: string | null } | null;
    }
  | null
  | undefined;

function isSuperAdminEmail(user: AdminCheckUser): boolean {
  if (!user) return false;
  const anyUser = user as any;
  const email = String(anyUser.email ?? anyUser.claims?.email ?? "").toLowerCase().trim();
  return email === "carrerajorge874@gmail.com";
}

export function isAdminUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  if (isSuperAdminEmail(user)) return true;

  // Some endpoints may hydrate an explicit boolean.
  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return role === "admin" || role === "superadmin";
}

export function isBillingManagerUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  if (isSuperAdminEmail(user)) return true;
  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "team_admin" ||
    role === "workspace_owner" ||
    role === "workspace_admin" ||
    role === "billing_manager" ||
    role === "owner"
  );
}

export function isWorkspaceManagerUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  if (isSuperAdminEmail(user)) return true;
  if ((user as any).isAdmin) return true;
  
  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "team_admin" ||
    role === "workspace_owner" ||
    role === "workspace_admin" ||
    role === "owner"
  );
}

export function isWorkspaceOwnerUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  if (isSuperAdminEmail(user)) return true;
  
  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return role === "workspace_owner" || role === "owner";
}
