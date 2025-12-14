import { useState } from "react";
import { 
  Menu, 
  Search, 
  Library, 
  Bot, 
  Plus, 
  MessageSquare, 
  MoreHorizontal,
  Settings,
  PanelLeftClose,
  ChevronDown,
  User,
  CreditCard,
  Shield,
  LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Chat } from "@/hooks/use-chats";
import { Trash2 } from "lucide-react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";

interface SidebarProps {
  className?: string;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat?: () => void;
  onToggle?: () => void;
  onDeleteChat?: (id: string, e: React.MouseEvent) => void;
}

export function Sidebar({ 
  className, 
  chats, 
  activeChatId, 
  onSelectChat, 
  onNewChat, 
  onToggle,
  onDeleteChat
}: SidebarProps) {
  
  const getChatDateLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    if (isThisWeek(date)) return "Previous 7 Days";
    if (isThisYear(date)) return format(date, "MMM d");
    return format(date, "yyyy");
  };

  // Group chats
  const groupedChats = chats.reduce((groups, chat) => {
    const label = getChatDateLabel(chat.timestamp);
    if (!groups[label]) groups[label] = [];
    groups[label].push(chat);
    return groups;
  }, {} as Record<string, Chat[]>);

  // Order of groups
  const groupOrder = ["Today", "Yesterday", "Previous 7 Days"];
  // Add other dynamic keys that might appear
  Object.keys(groupedChats).forEach(key => {
    if (!groupOrder.includes(key)) groupOrder.push(key);
  });
  
  return (
    <div className={cn("flex h-screen w-[260px] flex-col border-r bg-sidebar text-sidebar-foreground", className)}>
      <div className="flex h-14 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5">
             <Bot className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-none">Sira GPT</span>
            <span className="text-[10px] text-muted-foreground">AI Platform</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-2 py-2">
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium hover:bg-sidebar-accent"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium hover:bg-sidebar-accent"
        >
          <Search className="h-4 w-4" />
          Search chats
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium hover:bg-sidebar-accent"
        >
          <Library className="h-4 w-4" />
          Library
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium hover:bg-sidebar-accent"
        >
          <Bot className="h-4 w-4" />
          GPTs
        </Button>
      </div>

      <Separator className="mx-4 my-2 w-auto opacity-50" />

      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-4 pb-4">
          {groupOrder.map((group) => {
            const groupChats = groupedChats[group];
            if (!groupChats || groupChats.length === 0) return null;

            return (
              <div key={group} className="flex flex-col gap-0.5">
                <div className="px-2 py-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground/70">{group}</h3>
                </div>
                {groupChats.map((chat) => (
                  <Button
                    key={chat.id}
                    variant="ghost"
                    className={cn(
                      "group flex w-full flex-col items-start justify-center gap-0.5 px-2 py-3 text-left hover:bg-sidebar-accent",
                      activeChatId === chat.id && "bg-sidebar-accent"
                    )}
                    onClick={() => onSelectChat(chat.id)}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="truncate text-sm font-medium">{chat.title}</span>
                      {onDeleteChat && (
                        <div 
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-black/5 rounded"
                          onClick={(e) => onDeleteChat(chat.id, e)}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="mt-auto border-t p-4">
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-sidebar-accent transition-colors cursor-pointer" data-testid="button-user-menu">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-muted text-muted-foreground">A</AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col overflow-hidden text-left">
                <span className="truncate text-sm font-medium">Admin</span>
                <span className="truncate text-xs text-muted-foreground">ENTERPRISE</span>
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start" side="top">
            <div className="flex flex-col">
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal" data-testid="button-profile">
                <User className="h-4 w-4" />
                Profile
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal" data-testid="button-billing">
                <CreditCard className="h-4 w-4" />
                Billing
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal" data-testid="button-settings">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal" data-testid="button-privacy">
                <Shield className="h-4 w-4" />
                Privacy Policy
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal" data-testid="button-admin-panel">
                <Settings className="h-4 w-4" />
                Admin Panel
              </Button>
              <Separator className="my-1" />
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal text-red-500 hover:text-red-600 hover:bg-red-50" data-testid="button-logout">
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
