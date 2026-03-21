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
      className="flex flex-wrap gap-2.5 overflow-x-auto scrollbar-hide"
      data-testid="suggested-replies-container"
    >
      {suggestions.slice(0, 4).map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          className={cn(
            "min-h-10 rounded-full px-4 py-2 text-[13px] font-medium",
            "border border-white/45 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(247,249,255,0.82))] shadow-[0_10px_22px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))]",
            "text-muted-foreground hover:text-foreground",
            "transition-all duration-200 ease-in-out",
            "hover:-translate-y-0.5 hover:border-[#A5A0FF]/35 hover:shadow-[0_16px_28px_rgba(96,90,190,0.14)]",
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
