import { MessageSquareText, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MiniSidebarProps {
  className?: string;
  onExpand?: () => void;
}

export function MiniSidebar({ className, onExpand }: MiniSidebarProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={cn(
          "flex h-screen w-[88px] min-w-[88px] shrink-0 flex-col items-center px-3 py-4 border-r border-black/10 dark:border-white/10 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(238,243,244,0.82))] dark:bg-[linear-gradient(180deg,rgba(17,19,21,0.96),rgba(17,19,21,0.84))] backdrop-blur-xl",
          className
        )}
        aria-label="Acceso rápido al historial de chats"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className="group flex h-16 w-16 items-center justify-center rounded-2xl border border-black/10 bg-white/85 text-foreground shadow-[0_14px_30px_-22px_rgba(15,23,42,0.9)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              onClick={onExpand}
              data-testid="button-toggle-chat-history"
            >
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.04] text-muted-foreground transition-all duration-300 group-hover:bg-primary/10 group-hover:text-primary dark:bg-white/[0.08]">
                <MessageSquareText className="h-[18px] w-[18px]" />
                <PanelLeftOpen className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-background p-[1px] text-primary shadow-sm" />
              </div>
              <span className="sr-only">Mostrar historial de chats</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Mostrar historial de chats</p>
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
