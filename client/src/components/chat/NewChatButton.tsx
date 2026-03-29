import { useState, useCallback } from "react";
import { SquarePen, Loader2, Check } from "lucide-react";
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
  const [showSuccess, setShowSuccess] = useState(false);

  const handleClick = useCallback(() => {
    if (isCreating) return;

    onNewChat?.();

    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 800);
  }, [isCreating, onNewChat]);

  const baseClasses = "relative group font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 active:scale-[0.99]";

  const variantClasses = {
    full: "liquid-button flex min-h-[35px] w-full items-center justify-between gap-1.5 rounded-[12px] border border-transparent bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground shadow-md transition-all duration-300 hover:bg-primary/90 hover:shadow-[0_8px_18px_rgba(165,160,255,0.2)] hover:-translate-y-0.5 dark:hover:shadow-[0_8px_18px_rgba(165,160,255,0.1)]",
    compact: "liquid-button flex min-h-[35px] items-center justify-center gap-1.5 rounded-[12px] border border-white/35 bg-white/70 px-2.5 py-1 text-[12px] text-foreground transition-all duration-200 hover:border-[#A5A0FF]/35 hover:bg-white/88 hover:shadow-[0_8px_18px_rgba(96,90,190,0.09)] dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]",
    fab: "liquid-button fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full border border-border/40 bg-background/80 backdrop-blur-xl text-foreground shadow-lg hover:shadow-xl hover:-translate-y-1 md:hidden transition-all duration-300",
  };

  const successClasses = showSuccess ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "";

  const buttonContent = (
    <button
      className={cn(baseClasses, variantClasses[variant], successClasses, className)}
      onClick={handleClick}
      disabled={isCreating}
      data-testid="button-new-chat"
      title="Nuevo chat (Ctrl+N)"
    >
      <div className="flex items-center gap-1.5">
        {isCreating ? (
          <Loader2 className="h-[13px] w-[13px] animate-spin" />
        ) : showSuccess ? (
          <Check className="h-[13px] w-[13px]" />
        ) : (
          <SquarePen className="h-[13px] w-[13px]" />
        )}

        {variant !== "fab" && (
          <span>{isCreating ? "Creando..." : showSuccess ? "¡Creado!" : "Nuevo chat"}</span>
        )}
      </div>

      {variant === "full" && (
        <kbd className="hidden h-[19px] items-center rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-1 text-[8px] text-primary-foreground/80 lg:inline-flex">
          ⌘N
        </kbd>
      )}
    </button>
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

export function NewChatFab({ onNewChat }: { onNewChat?: () => void }) {
  return <NewChatButton onNewChat={onNewChat} variant="fab" showTooltip={false} />;
}
