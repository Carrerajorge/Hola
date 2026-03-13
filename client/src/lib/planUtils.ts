export type UserPlan = {
  plan?: string | null;
  role?: string | null;
  isAdmin?: boolean | null;
  isPaid?: boolean | null;
  subscriptionStatus?: string | null;
  subscriptionPlan?: string | null;
  subscriptionPeriodEnd?: string | Date | null;
  subscriptionExpiresAt?: string | Date | null;
  willDeactivate?: boolean | null;
};

function toLower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

const ACTIVE_PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function isAdminUser(user?: UserPlan | null): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;

  const role = toLower(user.role);
  return role === "admin" || role === "superadmin";
}

export function isActivePaidSubscriptionStatus(status: string | null | undefined): boolean {
  return ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(toLower(status));
}

function hasSubscriptionMetadata(user?: UserPlan | null): boolean {
  if (!user) return false;
  return Boolean(toLower(user.subscriptionStatus) || toLower(user.subscriptionPlan));
}

export function getEffectivePlan(user?: UserPlan | null): string {
  if (!user) return "free";

  if (isAdminUser(user)) return "admin";

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
  if (isAdminUser(user)) return false;
  if (typeof user?.isPaid === "boolean") return user.isPaid;

  const plan = getEffectivePlan(user);
  return plan !== "free" && plan !== "admin";
}

export function shouldShowUpgradeCTA(user?: UserPlan | null): boolean {
  if (!user) return true;

  const effectivePlan = getEffectivePlan(user);
  if (isAdminUser(user) || effectivePlan === "admin") {
    return false;
  }

  if (user.willDeactivate === true) {
    return true;
  }

  const subscriptionStatus = toLower(user.subscriptionStatus);
  const subscriptionPlan = toLower(user.subscriptionPlan);
  const plan = toLower(user.plan);

  if (hasSubscriptionMetadata(user)) {
    const hasActivePaidSubscription =
      isActivePaidSubscriptionStatus(subscriptionStatus) &&
      (subscriptionPlan ? subscriptionPlan !== "free" : plan !== "free");
    return !hasActivePaidSubscription;
  }

  if (typeof user.isPaid === "boolean") {
    return !user.isPaid;
  }

  return !isPaidPlan(user);
}
