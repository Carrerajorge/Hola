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
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-orange-100 text-orange-600">A</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium">Admin</span>
            <span className="truncate text-xs text-muted-foreground">ENTERPRISE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
