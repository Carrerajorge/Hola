import React from "react";
import { cn } from "@/lib/utils";
import {
    FileText,
    BarChart3,
    Search,
    Presentation,
    ListChecks,
    Languages,
    Sparkles,
    MessageSquare
} from "lucide-react";

interface PromptSuggestion {
    label: string;
    action: string;
    icon: React.ReactNode;
    category: "analyze" | "create" | "search" | "general";
}

const DEFAULT_SUGGESTIONS: PromptSuggestion[] = [
    {
        label: "Resumir documento",
        action: "Dame un resumen ejecutivo del documento",
        icon: <FileText className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Analizar datos",
        action: "Analiza los datos y dame los hallazgos clave",
        icon: <BarChart3 className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Extraer puntos clave",
        action: "Extrae los puntos más importantes del documento",
        icon: <ListChecks className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Buscar información",
        action: "Busca información sobre ",
        icon: <Search className="w-4 h-4" />,
        category: "search"
    },
    {
        label: "Crear presentación",
        action: "Crea una presentación profesional sobre ",
        icon: <Presentation className="w-4 h-4" />,
        category: "create"
    },
    {
        label: "Traducir",
        action: "Traduce el contenido al inglés",
        icon: <Languages className="w-4 h-4" />,
        category: "general"
    }
];

const DOCUMENT_SUGGESTIONS: PromptSuggestion[] = [
    {
        label: "Resumen ejecutivo",
        action: "Dame un resumen ejecutivo conciso",
        icon: <Sparkles className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Hallazgos clave",
        action: "¿Cuáles son los hallazgos más importantes?",
        icon: <ListChecks className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Analizar datos",
        action: "Analiza los datos numéricos del documento",
        icon: <BarChart3 className="w-4 h-4" />,
        category: "analyze"
    },
    {
        label: "Preguntas sugeridas",
        action: "¿Qué preguntas debería hacer sobre este documento?",
        icon: <MessageSquare className="w-4 h-4" />,
        category: "general"
    }
];

interface PromptSuggestionsProps {
    onSelect: (action: string) => void;
    hasAttachment?: boolean;
    className?: string;
}

export function PromptSuggestions({
    onSelect,
    hasAttachment = false,
    className
}: PromptSuggestionsProps) {
    const suggestions = hasAttachment ? DOCUMENT_SUGGESTIONS : DEFAULT_SUGGESTIONS;

    return (
        <div className={cn(
            "flex flex-wrap gap-2 p-3 animate-in fade-in-50 duration-300",
            className
        )}>
            {suggestions.map((suggestion, index) => (
                <button
                    key={index}
                    onClick={() => onSelect(suggestion.action)}
                    className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-full",
                        "text-sm font-medium transition-all duration-200",
                        "bg-muted/50 hover:bg-muted border border-border/50",
                        "hover:border-primary/30 hover:shadow-sm",
                        "active:scale-95",
                        suggestion.category === "analyze" && "hover:bg-blue-50 hover:border-blue-200 dark:hover:bg-blue-950/30",
                        suggestion.category === "create" && "hover:bg-green-50 hover:border-green-200 dark:hover:bg-green-950/30",
                        suggestion.category === "search" && "hover:bg-purple-50 hover:border-purple-200 dark:hover:bg-purple-950/30"
                    )}
                >
                    <span className="text-muted-foreground">{suggestion.icon}</span>
                    <span>{suggestion.label}</span>
                </button>
            ))}
        </div>
    );
}

export default PromptSuggestions;
