import { memo } from "react";
import { cn } from "@/lib/utils";
import { Brain, Sparkles, Search, FileText, Code, Globe } from "lucide-react";

type ThinkingPhase = 
  | "thinking" 
  | "searching" 
  | "analyzing" 
  | "generating" 
  | "coding"
  | "browsing";

interface ThinkingIndicatorProps {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  variant?: "minimal" | "detailed" | "inline";
}

const phaseConfig: Record<ThinkingPhase, { icon: typeof Brain; label: string; color: string }> = {
  thinking: { icon: Brain, label: "Pensando", color: "text-purple-500" },
  searching: { icon: Search, label: "Buscando", color: "text-blue-500" },
  analyzing: { icon: FileText, label: "Analizando", color: "text-amber-500" },
  generating: { icon: Sparkles, label: "Generando", color: "text-emerald-500" },
  coding: { icon: Code, label: "Programando", color: "text-cyan-500" },
  browsing: { icon: Globe, label: "Navegando", color: "text-indigo-500" },
};

export const ThinkingIndicator = memo(function ThinkingIndicator({
  phase = "thinking",
  message,
  className,
  variant = "detailed",
}: ThinkingIndicatorProps) {
  const config = phaseConfig[phase];
  const Icon = config.icon;

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full bg-current animate-bounce",
                config.color
              )}
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
        <span className="text-sm text-muted-foreground">
          {message || config.label}...
        </span>
      </span>
    );
  }

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl",
        "bg-gradient-to-r from-muted/50 to-muted/30",
        "border border-border/50",
        className
      )}
    >
      <div className={cn("relative", config.color)}>
        <Icon className="w-5 h-5 animate-pulse" />
        <div className="absolute inset-0 animate-ping opacity-30">
          <Icon className="w-5 h-5" />
        </div>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {message || config.label}
          </span>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-foreground/60 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
});

interface ThinkingDotsProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const ThinkingDots = memo(function ThinkingDots({
  className,
  size = "md",
}: ThinkingDotsProps) {
  const sizeClasses = {
    sm: "w-1 h-1",
    md: "w-1.5 h-1.5",
    lg: "w-2 h-2",
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-full bg-current animate-bounce",
            sizeClasses[size]
          )}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
});

export default ThinkingIndicator;
