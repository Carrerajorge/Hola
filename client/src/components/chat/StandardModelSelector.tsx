import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { GeminiCliOAuthButton } from "./GeminiCliOAuthButton";
import { OpenAICodexOAuthButton } from "./OpenAICodexOAuthButton";

interface StandardModelSelectorProps {
    availableModels: AvailableModel[];
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    modelsByProvider: Record<string, AvailableModel[]>;
    activeGptName?: string;
    onModelChange?: (id: string) => void;
    modelChangeDisabled?: boolean;
    refetchModels?: () => Promise<unknown> | unknown;
    showOAuthProviderButtons?: boolean;
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
    showOAuthProviderButtons,
    showGeminiCliOAuthButton = false
}: StandardModelSelectorProps) {
    const isAnyModelAvailable = availableModels.length > 0;
    const isDisabled = !!activeGptName || modelChangeDisabled;
    const showProviderButtons = showOAuthProviderButtons ?? showGeminiCliOAuthButton;

    const handleConnectedModel = React.useCallback(async (modelId: string) => {
        await Promise.resolve(refetchModels?.());
        window.setTimeout(() => {
            const handler = onModelChange ?? setSelectedModelId;
            handler(modelId);
        }, 0);
    }, [onModelChange, refetchModels, setSelectedModelId]);

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
        if (providerText === "openai-codex") return "ChatGPT OAuth";
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
                {showProviderButtons ? <OpenAICodexOAuthButton onConnected={handleConnectedModel} /> : null}
                {showProviderButtons ? <GeminiCliOAuthButton onConnected={handleConnectedModel} /> : null}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <div
                className={cn(
                    "relative flex min-h-11 items-center gap-2 rounded-full border border-white/45 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(245,247,255,0.82))] px-3 py-2 shadow-[0_14px_30px_rgba(15,23,42,0.08)] transition-all dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))]",
                    isDisabled ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5 hover:border-[#A5A0FF]/35 hover:shadow-[0_18px_34px_rgba(96,90,190,0.12)]"
                )}
                data-testid="button-model-selector"
                title={activeGptName ? `Modelo fijado por GPT: ${activeGptName}` : modelChangeDisabled ? "Respuesta en curso" : "Seleccionar modelo"}
            >
                <select
                    className={cn(
                        "appearance-none bg-transparent pr-6 font-semibold text-xs sm:text-sm text-foreground truncate max-w-[160px] sm:max-w-none outline-none",
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
                <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </div>
            {showProviderButtons ? <OpenAICodexOAuthButton onConnected={handleConnectedModel} /> : null}
            {showProviderButtons ? <GeminiCliOAuthButton onConnected={handleConnectedModel} /> : null}
        </div>
    );
}

// Ensure default export compatibility if needed, but named is preferred
export default StandardModelSelector;
