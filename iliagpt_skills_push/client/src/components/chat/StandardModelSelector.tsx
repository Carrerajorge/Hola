import React from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";

interface StandardModelSelectorProps {
    availableModels: AvailableModel[];
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    modelsByProvider: Record<string, AvailableModel[]>;
    activeGptName?: string;
}

export function StandardModelSelector({
    availableModels,
    selectedModelId,
    setSelectedModelId,
    modelsByProvider,
    activeGptName
}: StandardModelSelectorProps) {
    const isAnyModelAvailable = availableModels.length > 0;

    // Derived selected model data
    const selectedModelData = React.useMemo(() => {
        if (!selectedModelId) return availableModels[0] || null;
        return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
    }, [selectedModelId, availableModels]);

    if (!isAnyModelAvailable) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div
                            className="flex items-center gap-1 sm:gap-2 bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-1 rounded-md cursor-not-allowed opacity-60"
                            data-testid="button-model-selector-disabled"
                        >
                            <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none text-gray-500 dark:text-gray-400">
                                Sin modelos activos
                            </span>
                            <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>No hay modelos disponibles. Un administrador debe activar al menos un modelo.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <div
                    className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                    data-testid="button-model-selector"
                >
                    <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                        {/* Show Active GPT Name (if it's a Standard Model wrapper) or Selected Model Name */}
                        {activeGptName || selectedModelData?.name || "Seleccionar modelo"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-96 overflow-y-auto">
                {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                    <React.Fragment key={provider}>
                        {providerIndex > 0 && <DropdownMenuSeparator />}
                        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                            {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : provider}
                        </div>
                        {models.map((model) => (
                            <DropdownMenuItem
                                key={model.id}
                                className={cn("flex items-center gap-2", selectedModelData?.id === model.id ? "bg-muted" : "")}
                                onClick={() => setSelectedModelId(model.id)}
                            >
                                {selectedModelData?.id === model.id && <Check className="h-4 w-4" />}
                                <span className={cn(selectedModelData?.id !== model.id ? "pl-6" : "")}>{model.name}</span>
                            </DropdownMenuItem>
                        ))}
                    </React.Fragment>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// Ensure default export compatibility if needed, but named is preferred
export default StandardModelSelector;
