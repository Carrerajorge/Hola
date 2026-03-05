/**
 * Admin Navigation Hook & Context
 * Provides cross-section navigation with deep-link context for the admin panel.
 * Any admin section can call navigateTo("users", { selectedUserId: "abc" })
 * and the Users section will open with that user pre-selected.
 */
import { createContext, useContext } from "react";

export type AdminSection =
    | "dashboard"
    | "users"
    | "conversations"
    | "ai-models"
    | "payments"
    | "invoices"
    | "analytics"
    | "database"
    | "security"
    | "reports"
    | "settings"
    | "agentic"
    | "excel"
    | "terminal";

export interface AdminNavigationContext {
    /** Currently active admin section */
    activeSection: AdminSection;
    /** Navigate to a section, optionally passing deep-link context */
    navigateTo: (section: AdminSection, context?: Record<string, any>) => void;
    /** Context passed from the navigation source – consumed once by the target section */
    navigationContext: Record<string, any> | null;
    /** Clear navigation context after consuming it */
    clearNavigationContext: () => void;
}

export const AdminNavContext = createContext<AdminNavigationContext>({
    activeSection: "dashboard",
    navigateTo: () => { },
    navigationContext: null,
    clearNavigationContext: () => { },
});

/**
 * Hook to access admin navigation from any section component.
 *
 * Usage:
 *   const { navigateTo } = useAdminNavigation();
 *   navigateTo("payments", { userId: "123" });
 */
export function useAdminNavigation() {
    return useContext(AdminNavContext);
}
