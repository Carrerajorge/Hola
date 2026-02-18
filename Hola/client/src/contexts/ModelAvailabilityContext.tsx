import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: string | null;
  enabledByAdminId: string | null;
  displayOrder: number;
  icon: string | null;
  modelType: string;
  contextWindow: number | null;
}

interface ModelAvailabilityContextType {
  availableModels: AvailableModel[];
  allModels: AvailableModel[];
  isLoading: boolean;
  isAnyModelAvailable: boolean;
  enableModel: (id: string) => Promise<void>;
  disableModel: (id: string) => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
  refetch: () => void;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
}

const ModelAvailabilityContext = createContext<ModelAvailabilityContextType | null>(null);

/**
 * Produce a stable fingerprint of model IDs so we can use it in dependency
 * arrays without triggering spurious effects when the server returns the same
 * list with a new object reference.
 */
function modelListFingerprint(models: AvailableModel[]): string {
  return models.map((m) => m.id).join(",");
}

export function ModelAvailabilityProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const { settings, updateSetting } = useSettingsContext();
  const { settings: platformSettings } = usePlatformSettings();

  // ──────────────────────────────────────────────────────────────
  // 1. Fetch with stale-while-revalidate: keep cached data while
  //    background refetch happens → no isLoading flicker.
  // ──────────────────────────────────────────────────────────────
  const { data: modelsData, isLoading: isQueryLoading, refetch } = useQuery<{ models: AvailableModel[] }>({
    queryKey: ["/api/models/available"],
    queryFn: async () => {
      const res = await fetch("/api/models/available", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
      });
      if (!res.ok) throw new Error("Failed to fetch models");
      return res.json();
    },
    refetchInterval: 30000,
    // Keep data fresh for 30s – background refetches won't toggle isLoading.
    staleTime: 30000,
    gcTime: 60000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    // Keep previous data during refetches to avoid UI flickers.
    placeholderData: (prev) => prev,
  });

  // Only report loading on the very first fetch (no cached data yet).
  const isLoading = isQueryLoading && !modelsData;

  // ──────────────────────────────────────────────────────────────
  // 2. Memoize derived model lists with stable references.
  // ──────────────────────────────────────────────────────────────
  const rawModels = modelsData?.models;

  const allModels = useMemo(() => rawModels ?? [], [rawModels]);

  const enabledModels = useMemo(
    () =>
      allModels
        .filter((m) => m.isEnabled === "true")
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)),
    [allModels],
  );

  // Stable fingerprint – only changes when the *actual* set of enabled models changes.
  const enabledFingerprint = modelListFingerprint(enabledModels);

  const availableModels = useMemo(() => {
    const recommendedModels = enabledModels.slice(0, 3);

    if (settings.showAdditionalModels) return enabledModels;

    // Keep the currently selected model visible even when "additional models" are hidden.
    const visible = [...recommendedModels];
    if (selectedModelId) {
      const selected = enabledModels.find((m) => m.id === selectedModelId || m.modelId === selectedModelId);
      if (selected && !visible.some((m) => m.id === selected.id)) {
        visible.push(selected);
      }
    }
    return visible;
  }, [enabledModels, settings.showAdditionalModels, selectedModelId]);

  const isAnyModelAvailable = availableModels.length > 0;

  // ──────────────────────────────────────────────────────────────
  // 3. Stable setter – use a ref for enabledModels to avoid
  //    recreating the callback on every model-list change.
  // ──────────────────────────────────────────────────────────────
  const enabledModelsRef = useRef(enabledModels);
  enabledModelsRef.current = enabledModels;

  const setSelectedModelId = useCallback((id: string | null) => {
    if (id && !enabledModelsRef.current.find(m => m.id === id || m.modelId === id)) {
      toast({
        title: "Modelo no disponible",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
      return;
    }
    setSelectedModelIdState(id);
  }, [toast]);

  // ──────────────────────────────────────────────────────────────
  // 4. Effects – use enabledFingerprint to avoid re-running when
  //    the server returns an identical list with a new reference.
  // ──────────────────────────────────────────────────────────────

  // Reset selection when the previously-selected model disappears.
  useEffect(() => {
    if (selectedModelId && !enabledModelsRef.current.find(m => m.id === selectedModelId || m.modelId === selectedModelId)) {
      toast({
        title: "Modelo desactivado",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledFingerprint, selectedModelId, toast]);

  // Initialize selected model from Settings -> Default Model.
  useEffect(() => {
    if (selectedModelId) return;

    const models = enabledModelsRef.current;
    const legacyDefaultModelIds = new Set(["gemini-2.5-flash"]);

    const findEnabled = (id: string) =>
      models.find((m) => m.modelId === id || m.id === id);

    const userDefault = settings.defaultModel;
    const platformDefault = platformSettings.default_model;
    const preferPlatformDefault =
      !userDefault || legacyDefaultModelIds.has(userDefault);

    const primary = preferPlatformDefault ? platformDefault : userDefault;
    const secondary = preferPlatformDefault ? userDefault : platformDefault;

    const target = (primary ? findEnabled(primary) : undefined) || (secondary ? findEnabled(secondary) : undefined);
    if (target) {
      setSelectedModelIdState(target.id);
      return;
    }
    if (models[0]) {
      setSelectedModelIdState(models[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledFingerprint, selectedModelId, settings.defaultModel, platformSettings.default_model]);

  // Keep Settings -> Default Model in sync with the selector.
  useEffect(() => {
    if (!selectedModelId) return;
    const model = enabledModelsRef.current.find((m) => m.id === selectedModelId || m.modelId === selectedModelId);
    if (!model?.modelId) return;
    if (model.modelId !== settings.defaultModel) {
      updateSetting("defaultModel", model.modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, settings.defaultModel, updateSetting]);

  // If the user changes Default Model from Settings, reflect it in the selector.
  useEffect(() => {
    if (!settings.defaultModel) return;
    const target = enabledModelsRef.current.find((m) => m.modelId === settings.defaultModel || m.id === settings.defaultModel);
    if (!target) return;
    if (selectedModelId === target.id || selectedModelId === target.modelId) return;
    setSelectedModelIdState(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, settings.defaultModel]);

  // ──────────────────────────────────────────────────────────────
  // 5. Mutations (unchanged logic, stable callbacks).
  // ──────────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/admin/models/${id}/toggle`, {
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

  const enableModel = useCallback(async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: true });
  }, [toggleMutation]);

  const disableModel = useCallback(async (id: string) => {
    await toggleMutation.mutateAsync({ id, enabled: false });
  }, [toggleMutation]);

  const toggleModel = useCallback(async (id: string, enabled: boolean) => {
    await toggleMutation.mutateAsync({ id, enabled });
  }, [toggleMutation]);

  // ──────────────────────────────────────────────────────────────
  // 6. Memoize Provider value so consumers only re-render when
  //    something actually changed.
  // ──────────────────────────────────────────────────────────────
  const contextValue = useMemo<ModelAvailabilityContextType>(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <ModelAvailabilityContext.Provider value={contextValue}>
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
