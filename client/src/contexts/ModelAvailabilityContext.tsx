import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

export function ModelAvailabilityProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);

  const { data: modelsData, isLoading, refetch } = useQuery<{ models: AvailableModel[] }>({
    queryKey: ["/api/models/available"],
    queryFn: async () => {
      const res = await fetch("/api/models/available");
      if (!res.ok) throw new Error("Failed to fetch models");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const allModels = modelsData?.models || [];
  const availableModels = allModels.filter((m) => m.isEnabled === "true");
  const isAnyModelAvailable = availableModels.length > 0;

  const setSelectedModelId = useCallback((id: string | null) => {
    if (id && !availableModels.find(m => m.id === id || m.modelId === id)) {
      toast({
        title: "Modelo no disponible",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
      return;
    }
    setSelectedModelIdState(id);
  }, [availableModels, toast]);

  useEffect(() => {
    if (selectedModelId && !availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId)) {
      toast({
        title: "Modelo desactivado",
        description: "El modelo seleccionado ya no está disponible",
        variant: "destructive",
      });
      setSelectedModelIdState(null);
    }
  }, [availableModels, selectedModelId, toast]);

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
