export type UserPlan = {
  plan?: string | null;
  role?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  subscriptionPeriodEnd?: string | Date | null;
  subscriptionExpiresAt?: string | Date | null;
};

function toLower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

const ACTIVE_PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function isActivePaidSubscriptionStatus(status: string | null | undefined): boolean {
  return ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(toLower(status));
}

export function getEffectivePlan(user?: UserPlan | null): string {
  if (!user) return "free";

  const role = toLower(user.role);
  if (role === "admin" || role === "superadmin") return "admin";

  const subStatus = toLower(user.subscriptionStatus);
  const subPlan = toLower(user.subscriptionPlan);
  const plan = toLower(user.plan);
  if (isActivePaidSubscriptionStatus(subStatus)) {
    if (subPlan) return subPlan;
    if (plan && plan !== "free") return plan;
    return "free";
  }
  if (subStatus) return "free";
  return plan || "free";
}

export function getPlanLabel(user?: UserPlan | null): string {
  const plan = getEffectivePlan(user);
  switch (plan) {
    case "free":
      return "Free";
    case "admin":
      return "Admin";
    case "enterprise":
    case "business":
      return "Enterprise";
    case "go":
      return "Go";
    case "plus":
      return "Plus";
    case "pro":
      return "Pro";
    default:
      // Fallback: show raw plan in a stable, non-shouty way
      return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Free";
  }
}

export function isPaidPlan(user?: UserPlan | null): boolean {
  const plan = getEffectivePlan(user);
  return plan !== "free" && plan !== "admin";
}
