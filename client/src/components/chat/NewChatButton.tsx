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
    full: "liquid-button flex min-h-12 w-full items-center justify-between gap-3 rounded-[20px] border border-white/45 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(245,247,255,0.86))] px-4 py-3 text-[13px] text-foreground shadow-[0_18px_40px_rgba(15,23,42,0.08)] hover:border-[#A5A0FF]/45 hover:shadow-[0_22px_46px_rgba(96,90,190,0.16)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))] dark:hover:bg-white/[0.09]",
    compact: "liquid-button flex min-h-11 items-center justify-center gap-2.5 rounded-[18px] border border-white/40 bg-white/75 px-4 py-2 text-[13px] text-foreground shadow-sm hover:border-[#A5A0FF]/35 hover:shadow-md dark:border-white/10 dark:bg-white/[0.07]",
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
      <div className="flex items-center gap-2">
        {isCreating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : showSuccess ? (
          <Check className="h-4 w-4" />
        ) : (
          <SquarePen className="h-4 w-4" />
        )}

        {variant !== "fab" && (
          <span>{isCreating ? "Creando..." : showSuccess ? "¡Creado!" : "Nuevo chat"}</span>
        )}
      </div>

      {variant === "full" && (
        <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border border-border text-muted-foreground bg-transparent">
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
