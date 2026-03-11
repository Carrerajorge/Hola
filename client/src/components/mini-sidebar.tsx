import { SquarePen, Search, Library, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { isAdminUser } from "@/lib/admin";

interface MiniSidebarProps {
  className?: string;
  onNewChat?: () => void;
  onExpand?: () => void;
}

export function MiniSidebar({ className, onNewChat, onExpand }: MiniSidebarProps) {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const displayName = isAdmin ? "Admin" : (user?.firstName || user?.email?.split("@")[0] || "Usuario");
  const avatarInitial = isAdmin ? "A" : (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase();
  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn(
        "flex h-screen w-[64px] flex-col items-center border-r border-white/35 bg-[radial-gradient(circle_at_top_left,rgba(165,160,255,0.18),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.86),rgba(248,250,252,0.76))] py-3 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-3xl dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(165,160,255,0.14),transparent_28%),linear-gradient(180deg,rgba(10,12,18,0.92),rgba(6,8,14,0.84))]",
        className
      )}>
        <div className="flex flex-col items-center gap-1 mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                onClick={onExpand}
              >
                <IliaGPTLogo size={24} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Expandir Sidebar</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                onClick={onNewChat}
                data-testid="mini-button-new-chat"
              >
                <SquarePen className="h-4 w-4 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>New Chat</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                data-testid="mini-button-search"
              >
                <Search className="h-4 w-4 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Search chats</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                data-testid="mini-button-library"
              >
                <Library className="h-4 w-4 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Library</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                data-testid="mini-button-gpts"
              >
                <Bot className="h-4 w-4 text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>GPTs</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 rounded-2xl border border-white/40 bg-white/70 shadow-sm transition-colors hover:bg-white dark:border-white/8 dark:bg-white/6 dark:hover:bg-white/10"
                data-testid="mini-button-user"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs">{avatarInitial}</AvatarFallback>
                </Avatar>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{displayName}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
