import { createContext, useContext, useEffect, ReactNode } from "react";
import { useSettings, applyTheme, applyAccentColor, UserSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";

interface SettingsContextType {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  updateSettings: (updates: Partial<UserSettings>) => void;
  resetSettings: () => void;
  syncSettingsToServer: () => Promise<boolean>;
  loadSettingsFromServer: () => Promise<boolean>;
  isSyncing: boolean;
  isAuthenticated: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within SettingsProvider");
  }
  return context;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const { settings, updateSetting, updateSettings, resetSettings, syncSettingsToServer, loadSettingsFromServer, isSyncing } = useSettings(user?.id);
  const { settings: platformSettings } = usePlatformSettings();

  useEffect(() => {
    // Platform theme mode is global; users can only override when platform is "auto".
    const effectiveAppearance: UserSettings["appearance"] =
      platformSettings.theme_mode === "dark"
        ? "dark"
        : platformSettings.theme_mode === "light"
          ? "light"
          : settings.appearance;

    applyTheme(effectiveAppearance);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (effectiveAppearance === "system") {
        applyTheme("system");
        // Do not override platform branding colors.
        applyAccentColor("default");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [settings.appearance, settings.accentColor, platformSettings.theme_mode]);

  useEffect(() => {
    // Platform branding controls --primary/--ring. Always clear per-user overrides.
    applyAccentColor("default");
  }, [platformSettings.primary_color, platformSettings.secondary_color, settings.accentColor, settings.appearance]);

  useEffect(() => {
    const root = document.documentElement;

    // Accessibility
    root.classList.toggle("high-contrast", settings.highContrast);
    root.classList.toggle("reduce-motion", settings.reducedMotion);

    // Font size: scale the app consistently (Tailwind uses rem units).
    root.style.fontSize =
      settings.fontSize === "small"
        ? "14px"
        : settings.fontSize === "large"
          ? "18px"
          : "16px";

    // Density: expose a few control sizing vars used by shared UI components.
    const density = settings.density;
    root.dataset.density = density;

    const varsByDensity: Record<typeof density, Record<string, string>> = {
      compact: {
        "--ui-control-h": "2rem",
        "--ui-control-h-sm": "1.75rem",
        "--ui-control-h-lg": "2.25rem",
        "--ui-control-icon": "2rem",
        "--ui-control-px": "0.75rem",
        "--ui-control-px-sm": "0.5rem",
        "--ui-control-px-lg": "1rem",
        "--ui-control-py": "0.375rem",
        "--ui-control-py-sm": "0.25rem",
        "--ui-control-py-lg": "0.5rem",
      },
      comfortable: {
        "--ui-control-h": "2.25rem",
        "--ui-control-h-sm": "2rem",
        "--ui-control-h-lg": "2.5rem",
        "--ui-control-icon": "2.25rem",
        "--ui-control-px": "1rem",
        "--ui-control-px-sm": "0.75rem",
        "--ui-control-px-lg": "2rem",
        "--ui-control-py": "0.5rem",
        "--ui-control-py-sm": "0.375rem",
        "--ui-control-py-lg": "0.625rem",
      },
      spacious: {
        "--ui-control-h": "2.5rem",
        "--ui-control-h-sm": "2.25rem",
        "--ui-control-h-lg": "2.75rem",
        "--ui-control-icon": "2.5rem",
        "--ui-control-px": "1.25rem",
        "--ui-control-px-sm": "1rem",
        "--ui-control-px-lg": "2.25rem",
        "--ui-control-py": "0.75rem",
        "--ui-control-py-sm": "0.5rem",
        "--ui-control-py-lg": "0.875rem",
      },
    };

    const vars = varsByDensity[density];
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  }, [settings.highContrast, settings.reducedMotion, settings.fontSize, settings.density]);

  const wrappedUpdateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    updateSetting(key, value);

    if (key === "appearance") {
      const effectiveAppearance: UserSettings["appearance"] =
        platformSettings.theme_mode === "dark"
          ? "dark"
          : platformSettings.theme_mode === "light"
            ? "light"
            : (value as UserSettings["appearance"]);

      applyTheme(effectiveAppearance);
      setTimeout(() => applyAccentColor("default"), 0);
    }
    if (key === "accentColor") {
      applyAccentColor("default");
    }
  };

  return (
    <SettingsContext.Provider value={{
      settings,
      updateSetting: wrappedUpdateSetting,
      updateSettings,
      resetSettings,
      syncSettingsToServer,
      loadSettingsFromServer,
      isSyncing,
      isAuthenticated,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}
