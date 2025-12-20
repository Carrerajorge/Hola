import { useState, useEffect, useCallback } from "react";

export interface UserSettings {
  // General
  appearance: "system" | "light" | "dark";
  accentColor: "default" | "blue" | "green" | "purple" | "orange" | "pink";
  spokenLanguage: string;
  voice: string;
  independentVoiceMode: boolean;
  showAdditionalModels: boolean;
  
  // Notifications
  notifResponses: "push" | "email" | "push_email" | "none";
  notifTasks: "push" | "email" | "push_email" | "none";
  notifProjects: "push" | "email" | "push_email" | "none";
  notifRecommendations: "push" | "email" | "push_email" | "none";
  
  // Personalization
  styleAndTone: "default" | "formal" | "casual" | "concise";
  customInstructions: string;
  nickname: string;
  occupation: string;
  aboutYou: string;
  allowMemories: boolean;
  allowRecordings: boolean;
  webSearch: boolean;
  codeInterpreter: boolean;
  canvas: boolean;
  voiceMode: boolean;
  advancedVoice: boolean;
  connectorSearch: boolean;
  
  // Data controls
  improveModel: boolean;
  remoteBrowser: boolean;
  shareLocation: boolean;
  
  // Security
  authApp: boolean;
  pushNotifications: boolean;
  
  // Account
  showName: boolean;
  receiveEmailComments: boolean;
  linkedInUrl: string;
  githubUrl: string;
  websiteDomain: string;
}

const defaultSettings: UserSettings = {
  // General
  appearance: "system",
  accentColor: "default",
  spokenLanguage: "auto",
  voice: "cove",
  independentVoiceMode: false,
  showAdditionalModels: true,
  
  // Notifications
  notifResponses: "push",
  notifTasks: "push_email",
  notifProjects: "email",
  notifRecommendations: "push_email",
  
  // Personalization
  styleAndTone: "default",
  customInstructions: "",
  nickname: "",
  occupation: "",
  aboutYou: "",
  allowMemories: true,
  allowRecordings: false,
  webSearch: true,
  codeInterpreter: true,
  canvas: true,
  voiceMode: true,
  advancedVoice: false,
  connectorSearch: false,
  
  // Data controls
  improveModel: false,
  remoteBrowser: true,
  shareLocation: false,
  
  // Security
  authApp: false,
  pushNotifications: false,
  
  // Account
  showName: true,
  receiveEmailComments: false,
  linkedInUrl: "",
  githubUrl: "",
  websiteDomain: "",
};

const STORAGE_KEY = "sira_user_settings";

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return defaultSettings;
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);

  const updateSetting = useCallback(<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    setSettingsState((prev) => {
      const updated = { ...prev, [key]: value };
      saveSettings(updated);
      return updated;
    });
  }, []);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...updates };
      saveSettings(updated);
      return updated;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveSettings(defaultSettings);
    setSettingsState(defaultSettings);
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettingsState(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
  };
}

export function applyAccentColor(color: UserSettings["accentColor"]) {
  const root = document.documentElement;
  
  const accentColors: Record<UserSettings["accentColor"], { light: string; dark: string }> = {
    default: { light: "0 0% 0%", dark: "0 0% 100%" },
    blue: { light: "217 91% 50%", dark: "217 91% 60%" },
    green: { light: "142 71% 45%", dark: "142 71% 55%" },
    purple: { light: "271 81% 56%", dark: "271 81% 66%" },
    orange: { light: "25 95% 53%", dark: "25 95% 63%" },
    pink: { light: "330 81% 60%", dark: "330 81% 70%" },
  };
  
  const isDark = root.classList.contains("dark");
  const colors = accentColors[color];
  const primaryColor = isDark ? colors.dark : colors.light;
  
  root.style.setProperty("--primary", primaryColor);
  root.style.setProperty("--ring", primaryColor);
  
  if (color === "default") {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
  }
}

export function applyTheme(theme: UserSettings["appearance"]) {
  const root = document.documentElement;
  
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}
