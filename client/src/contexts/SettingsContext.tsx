import { createContext, useContext, useEffect, ReactNode } from "react";
import { useSettings, applyTheme, applyAccentColor, UserSettings } from "@/hooks/use-settings";

interface SettingsContextType {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  updateSettings: (updates: Partial<UserSettings>) => void;
  resetSettings: () => void;
  syncSettingsToServer: () => Promise<boolean>;
  loadSettingsFromServer: () => Promise<boolean>;
  isSyncing: boolean;
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
  const { settings, updateSetting, updateSettings, resetSettings, syncSettingsToServer, loadSettingsFromServer, isSyncing } = useSettings();

  useEffect(() => {
    applyTheme(settings.appearance);
    
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (settings.appearance === "system") {
        applyTheme("system");
        applyAccentColor(settings.accentColor);
      }
    };
    
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [settings.appearance]);

  useEffect(() => {
    applyAccentColor(settings.accentColor);
  }, [settings.accentColor, settings.appearance]);

  const wrappedUpdateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    updateSetting(key, value);
    
    if (key === "appearance") {
      applyTheme(value as UserSettings["appearance"]);
      setTimeout(() => applyAccentColor(settings.accentColor), 0);
    }
    if (key === "accentColor") {
      applyAccentColor(value as UserSettings["accentColor"]);
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
    }}>
      {children}
    </SettingsContext.Provider>
  );
}
