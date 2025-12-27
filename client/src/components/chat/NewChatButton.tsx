import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { SquarePen, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NewChatButtonProps {
  onNewChat?: () => void;
  isCreating?: boolean;
  variant?: "full" | "compact" | "fab";
  className?: string;
  showTooltip?: boolean;
}

export function NewChatButton({
  onNewChat,
  isCreating = false,
  variant = "full",
  className,
  showTooltip = true,
}: NewChatButtonProps) {
  const [, setLocation] = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleClick = useCallback(() => {
    if (isCreating) return;
    
    setLocation("/");
    onNewChat?.();
    
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 500);
  }, [isCreating, setLocation, onNewChat]);

  const baseClasses = "transition-all duration-200 font-medium";
  
  const variantClasses = {
    full: "w-full justify-start gap-2 px-2 text-sm liquid-button",
    compact: "gap-1.5 px-3 text-sm",
    fab: "fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg hover:shadow-xl z-50",
  };

  const successClasses = showSuccess ? "ring-2 ring-green-500/50 bg-green-500/10" : "";

  const buttonContent = (
    <Button
      variant="ghost"
      className={cn(
        baseClasses,
        variantClasses[variant],
        successClasses,
        isHovered && "bg-accent/50",
        className
      )}
      onClick={handleClick}
      disabled={isCreating}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="button-new-chat"
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <SquarePen className={cn("h-4 w-4 transition-transform", isHovered && "scale-110")} />
      )}
      {variant !== "fab" && (
        <span className="flex items-center gap-1">
          Nuevo chat
          {isHovered && <Sparkles className="h-3 w-3 text-primary/70 animate-pulse" />}
        </span>
      )}
    </Button>
  );

  if (!showTooltip || variant === "full") {
    return buttonContent;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          <span>Nuevo chat</span>
          <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Ctrl+N</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
