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
        "flex h-screen w-[56px] flex-col items-center py-2 bg-[#eef3f4] dark:bg-[#111315] border-r border-black/10 dark:border-white/10",
        className
      )}>
        <div className="flex flex-col items-center gap-1 mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
                className="h-9 w-9 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
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
