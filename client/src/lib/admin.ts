export type AdminCheckUser =
  | {
      role?: string | null;
      isAdmin?: boolean | null;
    }
  | null
  | undefined;

export function isAdminUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  // Some endpoints may hydrate an explicit boolean.
  if ((user as any).isAdmin) return true;

  if (user.role === "admin") return true;
  return false;
}
