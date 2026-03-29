import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { apiFetch } from "@/lib/apiClient";
import { shouldBootstrapWorkspaceSurface } from "@/lib/auth-flow";
import { useAuth } from "@/hooks/use-auth";

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: string | null;
  enabledByAdminId?: string | null;
  displayOrder: number;
  icon: string | null;
  modelType: string;
  contextWindow: number | null;
  /** Token source: global (admin), user (personal), env (API key), or bootstrap */
  source?: "global" | "user" | "env" | "bootstrap";
}

const PREFERRED_PROVIDER_ORDER = Object.freeze([
  "google-gemini-cli",
  "openrouter",
  "xai",
  "openai",
  "anthropic",
  "deepseek",
  "google",
  "gemini",
]);
const DEFAULT_VISIBLE_MODEL_LIMIT = 10;
const LEGACY_MODEL_ID_ALIASES = Object.freeze({
  "grok-4-1-fast-non-reasoning": ["grok-4.1-fast", "grok-code-fast-1"],
  "grok-4-1-fast-reasoning": ["grok-4.1-fast-reasoning"],
  "gemini-2.5-flash": ["gemini-2.5-flash-lite"],
} satisfies Record<string, string[]>);

export function shouldExposeLocalMockModels(hostname?: string): boolean {
  const host = (hostname || "").trim().toLowerCase();
  if (!host) return false;
  return host === "localhost" || host === "127.0.0.1";
}

function isDeepSeekModel(model: AvailableModel): boolean {
  return model.provider.trim().toLowerCase() === "deepseek" || /^deepseek/i.test(model.modelId.trim());
}

function isGeminiCliModel(model: AvailableModel): boolean {
  return model.provider.trim().toLowerCase() === "google-gemini-cli";
}

export function pickPreferredEnabledModel(
  enabledModels: AvailableModel[],
  primaryId?: string | null,
  secondaryId?: string | null
): AvailableModel | null {
  const getCandidateIds = (id?: string | null): string[] => {
    const safeId = typeof id === "string" ? id.trim() : "";
    if (!safeId) return [];

    const unquoted = safeId.replace(/^["']+|["']+$/g, "").trim();
    if (!unquoted) return [];

    const normalized = unquoted.toLowerCase();
    const candidates = [
      unquoted,
      ...(LEGACY_MODEL_ID_ALIASES[normalized as keyof typeof LEGACY_MODEL_ID_ALIASES] ?? []),
    ];

    return Array.from(new Set(candidates));
  };

  const findEnabled = (id?: string | null) => {
    const candidates = getCandidateIds(id);
    if (candidates.length === 0) return undefined;

    return enabledModels.find((model) =>
      candidates.some(
        (candidate) => model.modelId === candidate || model.id === candidate,
      ),
    );
  };

  const explicit = findEnabled(primaryId) || findEnabled(secondaryId);
  if (explicit) return explicit;

  for (const provider of PREFERRED_PROVIDER_ORDER) {
    const candidate = enabledModels.find((model) => model.provider === provider);
    if (candidate) return candidate;
  }

  return enabledModels[0] || null;
}

export function selectVisibleModels(params: {
  enabledModels: AvailableModel[];
  selectedModelId: string | null;
  showAdditionalModels: boolean;
}): AvailableModel[] {
  const { enabledModels, selectedModelId, showAdditionalModels } = params;

  if (showAdditionalModels) return enabledModels;

  const visible = enabledModels.slice(0, DEFAULT_VISIBLE_MODEL_LIMIT);
  const selected = selectedModelId
    ? enabledModels.find((model) => model.id === selectedModelId || model.modelId === selectedModelId) ?? null
    : null;

  if (selected && !visible.some((model) => model.id === selected.id)) {
    visible.push(selected);
  }

  const deepSeekModel = enabledModels.find((model) => isDeepSeekModel(model)) ?? null;
  if (deepSeekModel && !visible.some((model) => model.id === deepSeekModel.id)) {
    if (visible.length < DEFAULT_VISIBLE_MODEL_LIMIT) {
      visible.push(deepSeekModel);
    } else {
      const replaceIndex = visible.findLastIndex((model) => !selected || model.id !== selected.id);
      if (replaceIndex >= 0) {
        visible[replaceIndex] = deepSeekModel;
      } else {
        visible.push(deepSeekModel);
      }
    }
  }

  const geminiCliModel = enabledModels.find((model) => isGeminiCliModel(model)) ?? null;
  if (geminiCliModel && !visible.some((model) => model.id === geminiCliModel.id)) {
    if (visible.length < DEFAULT_VISIBLE_MODEL_LIMIT) {
      visible.push(geminiCliModel);
    } else {
      const replaceIndex = visible.findLastIndex(
        (model) => !selected || (model.id !== selected.id && model.id !== deepSeekModel?.id),
      );
      if (replaceIndex >= 0) {
        visible[replaceIndex] = geminiCliModel;
      } else {
        visible.push(geminiCliModel);
      }
    }
  }

  return Array.from(new Map(visible.map((model) => [model.id, model])).values());
}

function toSafeString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function normalizeAvailableModel(raw: unknown, index: number): AvailableModel | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const provider = toSafeString(source.provider, "").trim().toLowerCase();
  const modelId = toSafeString(source.modelId, "").trim();
  const id = toSafeString(source.id, "").trim() || `${provider || "model"}-${modelId || index}`;
  const name = toSafeString(source.name, "").trim() || modelId || id;

  if (!provider || !modelId) return null;

  return {
    id,
    name,
    provider,
    modelId,
    description: typeof source.description === "string" ? source.description : null,
    isEnabled: source.isEnabled === "true" || source.isEnabled === true ? "true" : "false",
    enabledAt: typeof source.enabledAt === "string" ? source.enabledAt : null,
    enabledByAdminId: typeof source.enabledByAdminId === "string" ? source.enabledByAdminId : null,
    displayOrder: typeof source.displayOrder === "number" && Number.isFinite(source.displayOrder) ? source.displayOrder : 0,
    icon: typeof source.icon === "string" ? source.icon : null,
    modelType: typeof source.modelType === "string" ? source.modelType : "TEXT",
    contextWindow: typeof source.contextWindow === "number" && Number.isFinite(source.contextWindow)
      ? source.contextWindow
      : null,
  };
}

interface ModelAvailabilityContextType {
  availableModels: AvailableModel[];
  allModels: AvailableModel[];
  isLoading: boolean;
  isAnyModelAvailable: boolean;
  enableModel: (id: string) => Promise<void>;
  disableModel: (id: string) => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
  refetch: () => Promise<unknown> | unknown;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
}

const ModelAvailabilityContext = createContext<ModelAvailabilityContextType | null>(null);

export function ModelAvailabilityProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const { settings, updateSetting } = useSettingsContext();
  const { settings: platformSettings } = usePlatformSettings();
  const shouldLoadModels = true; // Always load models for chat interface

  const { data: modelsData, isLoading: isQueryLoading, refetch } = useQuery<{ models: AvailableModel[] }>({
    queryKey: ["/api/models/available"],
    queryFn: async () => {
      const res = await apiFetch("/api/models/available", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to fetch models`);
      return res.json();
    },
    meta: { suppressGlobalErrorToast: true },
    refetchInterval: 30000,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled: shouldLoadModels,
  });
  const isLoading = shouldLoadModels ? isQueryLoading : false;

  const remoteModels = (modelsData?.models || [])
    .map((model, index) => normalizeAvailableModel(model, index))
    .filter((model): model is AvailableModel => model !== null);

  const dedupedRemoteModels = Array.from(
    new Map(remoteModels.map((model) => [model.id, model])).values()
  );

  const localMockModels: AvailableModel[] =
    !isLoading &&
    shouldExposeLocalMockModels(typeof window !== "undefined" ? window.location.hostname : "") &&
    dedupedRemoteModels.length === 0
      ? [
          {
            id: "llama3-8b",
            name: "Llama 3 (M\u00e1quina Local / Ollama)",
            provider: "local",
            modelId: "llama3-8b",
            description: "Modelo Llama 3 ejecutado directamente en su hardware local via ollama o LM Studio",
            isEnabled: "true",
            enabledAt: new Date().toISOString(),
            enabledByAdminId: "system",
            displayOrder: -1,
            icon: null,
            modelType: "chat",
            contextWindow: 128000,
          },
        ]
      : [];

  const allModels = [...localMockModels, ...dedupedRemoteModels];
  const enabledModels = allModels
    .filter((m) => m.isEnabled === "true")
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  const availableModels = selectVisibleModels({
    enabledModels,
    selectedModelId,
    showAdditionalModels: settings.showAdditionalModels,
  });

  const isAnyModelAvailable = availableModels.length > 0;

  const setSelectedModelId = useCallback((id: string | null) => {
    const normalizedId = typeof id === "string" && id.trim().length > 0 ? id : null;
    if (normalizedId && !enabledModels.find(m => m.id === normalizedId || m.modelId === normalizedId)) {
      toast({
        title: "Modelo no disponible",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
      return;
    }
    setSelectedModelIdState(normalizedId);
  }, [enabledModels, toast]);

  useEffect(() => {
    if (selectedModelId && !enabledModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId)) {
      toast({
        title: "Modelo desactivado",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
    }
  }, [enabledModels, selectedModelId, toast]);

  // Initialize selected model from Settings -> Default Model.
  useEffect(() => {
    if (selectedModelId) return;

    const legacyDefaultModelIds = new Set(["gemini-2.5-flash"]);

    const userDefault = settings.defaultModel;
    const platformDefault = platformSettings.default_model;
    const preferPlatformDefault =
      !userDefault || legacyDefaultModelIds.has(userDefault);

    const primary = preferPlatformDefault ? platformDefault : userDefault;
    const secondary = preferPlatformDefault ? userDefault : platformDefault;

    const target = pickPreferredEnabledModel(enabledModels, primary, secondary);
    if (target) {
      setSelectedModelIdState(target.id);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel, platformSettings.default_model]);

  // Keep Settings -> Default Model in sync with the selector.
  useEffect(() => {
    if (!selectedModelId) return;
    const model = enabledModels.find((m) => m.id === selectedModelId || m.modelId === selectedModelId);
    if (!model?.modelId) return;
    if (model.modelId !== settings.defaultModel) {
      updateSetting("defaultModel", model.modelId);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel, updateSetting]);

  const prevDefaultModelRef = useRef(settings.defaultModel);

  // If the user changes Default Model from Settings, reflect it in the selector.
  useEffect(() => {
    if (settings.defaultModel !== prevDefaultModelRef.current) {
      prevDefaultModelRef.current = settings.defaultModel;
      if (!settings.defaultModel) return;
      const target = enabledModels.find((m) => m.modelId === settings.defaultModel || m.id === settings.defaultModel);
      if (!target) return;
      if (selectedModelId === target.id || selectedModelId === target.modelId) return;
      setSelectedModelIdState(target.id);
    }
  }, [enabledModels, selectedModelId, settings.defaultModel]);

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/admin/models/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle model");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      refetch();
    },
  });

  const enableModel = async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: true });
  };

  const disableModel = async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: false });
  };

  const toggleModel = async (id: string, enabled: boolean) => {
    await toggleMutation.mutateAsync({ id, enabled });
  };

  return (
    <ModelAvailabilityContext.Provider
      value={{
        availableModels,
        allModels,
        isLoading,
        isAnyModelAvailable,
        enableModel,
        disableModel,
        toggleModel,
        refetch,
        selectedModelId,
        setSelectedModelId,
      }}
    >
      {children}
    </ModelAvailabilityContext.Provider>
  );
}

export function useModelAvailability() {
  const context = useContext(ModelAvailabilityContext);
  if (!context) {
    throw new Error("useModelAvailability must be used within ModelAvailabilityProvider");
  }
  return context;
}
