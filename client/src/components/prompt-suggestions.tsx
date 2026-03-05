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
            "flex flex-wrap gap-2.5 justify-center p-3 animate-in fade-in-50 duration-500",
            className
        )}>
            {suggestions.map((suggestion, index) => (
                <button
                    key={index}
                    onClick={() => onSelect(suggestion.action)}
                    className={cn(
                        "group flex items-center gap-3 px-4 py-2.5 rounded-full",
                        "text-[13px] font-medium transition-all duration-300",
                        "bg-black/[0.03] dark:bg-white/[0.03] hover:bg-black/[0.08] dark:hover:bg-white/[0.08]",
                        "text-foreground/70 hover:text-foreground",
                        "active:scale-95"
                    )}
                >
                    <span className={cn(
                        "transition-colors duration-300 text-muted-foreground",
                        suggestion.category === "analyze" && "group-hover:text-blue-500 dark:group-hover:text-blue-400",
                        suggestion.category === "create" && "group-hover:text-green-500 dark:group-hover:text-green-400",
                        suggestion.category === "search" && "group-hover:text-purple-500 dark:group-hover:text-purple-400",
                        suggestion.category === "general" && "group-hover:text-foreground"
                    )}>
                        {suggestion.icon}
                    </span>
                    <span>{suggestion.label}</span>
                </button>
            ))}
        </div>
    );
}

export default PromptSuggestions;
