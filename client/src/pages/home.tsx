import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { useState, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useChats, Message } from "@/hooks/use-chats";
import { toast } from "sonner";

export default function Home() {
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  
  const { 
    chats, 
    hiddenChats,
    activeChat, 
    setActiveChatId, 
    createChat, 
    addMessage,
    deleteChat,
    editChatTitle,
    archiveChat,
    hideChat
  } = useChats();

  const handleNewChat = () => {
    setActiveChatId(null);
    setIsNewChatMode(true);
  };

  const handleSendNewChatMessage = useCallback((message: Message) => {
    const pendingId = createChat();
    setIsNewChatMode(false);
    setTimeout(() => {
      addMessage(pendingId, message);
    }, 50);
  }, [createChat, addMessage]);

  const handleSelectChat = (id: string) => {
    setIsNewChatMode(false);
    setActiveChatId(id);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden liquid-bg-light relative">
      <div className="liquid-blob liquid-blob-1 opacity-30"></div>
      <div className="liquid-blob liquid-blob-2 opacity-20"></div>
      <div className="liquid-blob liquid-blob-3 opacity-25"></div>
      
      {/* Desktop Sidebar - Full */}
      <div className={isSidebarOpen ? "hidden md:block" : "hidden"}>
        <Sidebar 
          chats={chats} 
          hiddenChats={hiddenChats}
          activeChatId={activeChat?.id || null} 
          onSelectChat={handleSelectChat} 
          onNewChat={handleNewChat} 
          onToggle={() => setIsSidebarOpen(false)} 
          onDeleteChat={deleteChat}
          onEditChat={editChatTitle}
          onArchiveChat={archiveChat}
          onHideChat={hideChat}
        />
      </div>

      {/* Desktop Sidebar - Mini (collapsed) */}
      <div className={!isSidebarOpen ? "hidden md:block" : "hidden"}>
        <MiniSidebar 
          onNewChat={handleNewChat}
          onExpand={() => setIsSidebarOpen(true)}
        />
      </div>

      {/* Mobile Sidebar */}
      <div className="md:hidden absolute top-4 left-4 z-50">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="glass-card-light">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[260px]">
            <Sidebar 
              chats={chats} 
              hiddenChats={hiddenChats}
              activeChatId={activeChat?.id || null} 
              onSelectChat={handleSelectChat} 
              onNewChat={handleNewChat} 
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
              onDeleteChat={deleteChat}
              onEditChat={editChatTitle}
              onArchiveChat={archiveChat}
              onHideChat={hideChat}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full w-full">
        {(activeChat || isNewChatMode || chats.length === 0) && (
          <ChatInterface 
            key={activeChat?.stableKey || "new-chat"} 
            messages={activeChat?.messages || []}
            onSendMessage={activeChat ? (msg) => addMessage(activeChat.id, msg) : handleSendNewChatMessage}
            isSidebarOpen={isSidebarOpen} 
            onToggleSidebar={() => setIsSidebarOpen(true)} 
          />
        )}
      </main>
    </div>
  );
}
