import { memo } from "react";
import { cn } from "@/lib/utils";

interface SuggestedRepliesProps {
  suggestions: string[];
  onSelect: (text: string) => void;
}

export const SuggestedReplies = memo(function SuggestedReplies({
  suggestions,
  onSelect
}: SuggestedRepliesProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div 
      className="flex flex-wrap gap-2 overflow-x-auto scrollbar-hide"
      data-testid="suggested-replies-container"
    >
      {suggestions.slice(0, 4).map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          className={cn(
            "px-3 py-1.5 text-xs rounded-full",
            "bg-muted/60 hover:bg-muted border border-border/50",
            "text-muted-foreground hover:text-foreground",
            "transition-all duration-200 ease-in-out",
            "hover:shadow-sm hover:border-border",
            "whitespace-nowrap flex-shrink-0"
          )}
          data-testid={`suggested-reply-${index}`}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
});

export function generateSuggestions(content: string): string[] {
  if (!content) return [];

  const lowerContent = content.toLowerCase();
  const hasCodeBlock = content.includes("```");
  const hasNumberedList = /^\s*\d+\.\s+/m.test(content);
  const hasBulletList = /^\s*[-*•]\s+/m.test(content);
  const hasList = hasNumberedList || hasBulletList;

  if (hasCodeBlock) {
    return [
      "Explica este código",
      "¿Cómo puedo mejorarlo?",
      "Muéstrame un ejemplo de uso",
      "¿Hay alternativas?"
    ];
  }

  if (hasList) {
    return [
      "Cuéntame más del primer punto",
      "Compara estas opciones",
      "¿Cuál recomiendas?",
      "Dame más detalles"
    ];
  }

  return [
    "¿Puedes elaborar más?",
    "Dame un ejemplo",
    "¿Cuáles son las alternativas?",
    "¿Qué más debo saber?"
  ];
}
