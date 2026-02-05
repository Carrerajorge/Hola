export type AdminCheckUser =
  | {
      role?: string | null;
      email?: string | null;
      isAdmin?: boolean | null;
    }
  | null
  | undefined;

const FALLBACK_ADMIN_EMAILS = new Set(['carrerajorge874@gmail.com']);

export function isAdminUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  // Some endpoints may hydrate an explicit boolean.
  if ((user as any).isAdmin) return true;

  if (user.role === 'admin') return true;

  const email = typeof user.email === 'string' ? user.email.toLowerCase().trim() : '';
  return email ? FALLBACK_ADMIN_EMAILS.has(email) : false;
}

