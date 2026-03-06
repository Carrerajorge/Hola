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

  const baseClasses = "relative group font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20";

  const variantClasses = {
    full: "flex w-full items-center justify-between gap-2 rounded-[18px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,246,248,0.92))] px-3 py-2 text-[14px] tracking-[-0.02em] text-foreground shadow-[0_24px_48px_-36px_rgba(15,23,42,0.85)] backdrop-blur-xl hover:-translate-y-[1px] hover:border-white hover:shadow-[0_30px_70px_-42px_rgba(15,23,42,0.95)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.05))] dark:hover:border-white/15 dark:hover:bg-white/[0.08]",
    compact: "flex items-center justify-center gap-2 px-3 py-1.5 text-[13px] rounded-full border border-white/60 bg-white/80 text-foreground shadow-sm backdrop-blur-md hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]",
    fab: "fixed bottom-6 right-6 z-50 flex items-center justify-center w-12 h-12 rounded-full border border-border/40 bg-background/80 backdrop-blur-md text-foreground shadow-sm hover:shadow-md hover:-translate-y-0.5 md:hidden transition-all",
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
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : showSuccess ? (
          <Check className="h-4 w-4 text-emerald-500" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-[12px] border border-black/5 bg-white/90 text-foreground shadow-[0_16px_30px_-24px_rgba(15,23,42,0.7)] transition-all duration-300 group-hover:border-primary/15 group-hover:text-primary dark:border-white/10 dark:bg-white/[0.08]">
            <SquarePen className="h-3.5 w-3.5" />
          </div>
        )}

        {variant !== "fab" && (
          <span className="font-semibold">{isCreating ? "Creando..." : showSuccess ? "¡Creado!" : "New chat"}</span>
        )}
      </div>

      {variant === "full" && (
        <kbd className="hidden lg:inline-flex items-center rounded-full border border-black/5 bg-black/[0.03] px-2 py-0 text-[10px] font-medium tracking-[0.18em] text-muted-foreground shadow-inner dark:border-white/10 dark:bg-white/[0.06]">
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
