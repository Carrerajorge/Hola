import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { GeminiCliOAuthButton } from "./GeminiCliOAuthButton";

interface StandardModelSelectorProps {
    availableModels: AvailableModel[];
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    modelsByProvider: Record<string, AvailableModel[]>;
    activeGptName?: string;
    onModelChange?: (id: string) => void;
    modelChangeDisabled?: boolean;
    refetchModels?: () => Promise<unknown> | unknown;
    showGeminiCliOAuthButton?: boolean;
}

const safeText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
};

export function StandardModelSelector({
    availableModels,
    selectedModelId,
    setSelectedModelId,
    modelsByProvider,
    activeGptName,
    onModelChange,
    modelChangeDisabled = false,
    refetchModels,
    showGeminiCliOAuthButton = false
}: StandardModelSelectorProps) {
    const isAnyModelAvailable = availableModels.length > 0;
    const isDisabled = !!activeGptName || modelChangeDisabled;

    // Derived selected model data
    const selectedModelData = React.useMemo(() => {
        if (!selectedModelId) return availableModels[0] || null;
        return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
    }, [selectedModelId, availableModels]);

    const providerLabel = (provider: string) => {
        const providerText = safeText(provider, "").trim().toLowerCase();
        if (providerText === "xai") return "xAI";
        if (providerText === "google" || providerText === "gemini") return "Google Gemini";
        if (providerText === "google-gemini-cli") return "Gemini CLI OAuth";
        return safeText(provider, "Proveedor");
    };

    if (!isAnyModelAvailable) {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="relative flex items-center gap-1 sm:gap-2 bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-1 rounded-md cursor-not-allowed opacity-60"
                    data-testid="button-model-selector-disabled"
                    title="No hay modelos disponibles. Un administrador debe activar al menos un modelo."
                >
                    <select
                        className="appearance-none bg-transparent pr-6 font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none text-gray-500 dark:text-gray-400 outline-none"
                        disabled
                        value=""
                        aria-label="Selector de modelo"
                    >
                        <option value="">Sin modelos activos</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-gray-400 flex-shrink-0" />
                </div>
                {showGeminiCliOAuthButton ? (
                    <GeminiCliOAuthButton
                        onConnected={async (modelId) => {
                            await Promise.resolve(refetchModels?.());
                            window.setTimeout(() => {
                                const handler = onModelChange ?? setSelectedModelId;
                                handler(modelId);
                            }, 0);
                        }}
                    />
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <div
                className={cn(
                    "relative flex items-center gap-1 sm:gap-2 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]",
                    isDisabled ? "cursor-not-allowed opacity-60" : "hover:bg-muted/50"
                )}
                data-testid="button-model-selector"
                title={activeGptName ? `Modelo fijado por GPT: ${activeGptName}` : modelChangeDisabled ? "Respuesta en curso" : "Seleccionar modelo"}
            >
                <select
                    className={cn(
                        "appearance-none bg-transparent pr-6 font-semibold text-xs sm:text-sm truncate max-w-[160px] sm:max-w-none outline-none",
                        isDisabled && "pointer-events-none"
                    )}
                    value={selectedModelData?.id || ""}
                    onChange={(e) => {
                        if (isDisabled) return;
                        const handler = onModelChange ?? setSelectedModelId;
                        handler(e.target.value);
                    }}
                    disabled={isDisabled}
                    aria-label="Selector de modelo"
                >
                    {Object.entries(modelsByProvider).map(([provider, models]) => (
                        <optgroup key={provider} label={providerLabel(provider)}>
                            {models.map((model) => (
                                <option
                                    key={safeText(model.id, model.modelId)}
                                    value={safeText(model.id, model.modelId)}
                                >
                                    {safeText(model.name, model.modelId)}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-muted-foreground flex-shrink-0" />
            </div>
            {showGeminiCliOAuthButton ? (
                <GeminiCliOAuthButton
                    onConnected={async (modelId) => {
                        await Promise.resolve(refetchModels?.());
                        window.setTimeout(() => {
                            const handler = onModelChange ?? setSelectedModelId;
                            handler(modelId);
                        }, 0);
                    }}
                />
            ) : null}
        </div>
    );
}

// Ensure default export compatibility if needed, but named is preferred
export default StandardModelSelector;
