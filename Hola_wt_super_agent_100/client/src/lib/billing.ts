export type BillingStatusPayload = {
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  willDeactivate: boolean;
};

export function shouldShowWorkspaceDeactivationBanner(input: {
  subscriptionStatus: string | null | undefined;
  subscriptionPeriodEnd: string | null | undefined;
  nowMs?: number;
}): boolean {
  const status = input.subscriptionStatus ?? null;
  const raw = input.subscriptionPeriodEnd ?? null;
  if (!status || status === "active") return false;
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  const now = input.nowMs ?? Date.now();
  return t > now;
}

export function formatPeriodEndEs(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) return null;
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
}
