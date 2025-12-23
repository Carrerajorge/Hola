import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { GptExplorer, Gpt } from "@/components/gpt-explorer";
import { GptBuilder } from "@/components/gpt-builder";
import { UserLibrary } from "@/components/user-library";
import { AppsView } from "@/components/apps-view";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useChats, Message } from "@/hooks/use-chats";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();


  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/welcome");
    }
  }, [isAuthenticated, isLoading, setLocation]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  const [newChatStableKey, setNewChatStableKey] = useState<string | null>(null);
  const [isGptExplorerOpen, setIsGptExplorerOpen] = useState(false);
  const [isGptBuilderOpen, setIsGptBuilderOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isAppsDialogOpen, setIsAppsDialogOpen] = useState(false);
  const [editingGpt, setEditingGpt] = useState<Gpt | null>(null);
  const [activeGpt, setActiveGpt] = useState<Gpt | null>(null);
  
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

  // AI processing state - kept in parent to survive ChatInterface key changes
  const [aiState, setAiState] = useState<"idle" | "thinking" | "responding">("idle");
  const [aiProcessSteps, setAiProcessSteps] = useState<{step: string; status: "pending" | "active" | "done"}[]>([]);

  // Store the pending chat ID during new chat creation
  const pendingChatIdRef = useRef<string | null>(null);

  const handleNewChat = () => {
    const newKey = `new-chat-${Date.now()}`;
    setActiveChatId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(newKey);
    pendingChatIdRef.current = null;
    // Reset AI state for new chat
    setAiState("idle");
    setAiProcessSteps([]);
  };
  
  const handleSendNewChatMessage = useCallback((message: Message) => {
    const { pendingId, stableKey } = createChat();
    pendingChatIdRef.current = pendingId;
    // Keep the new chat stable key to prevent component remount
    setNewChatStableKey(prev => prev || stableKey);
    setIsNewChatMode(false);
    addMessage(pendingId, message);
  }, [createChat, addMessage]);
  
  // Stable message sender that uses the correct chat ID
  const handleSendMessage = useCallback((message: Message) => {
    const targetChatId = activeChat?.id || pendingChatIdRef.current;
    if (targetChatId) {
      addMessage(targetChatId, message);
    } else {
      // Fallback: create new chat
      handleSendNewChatMessage(message);
    }
  }, [activeChat?.id, addMessage, handleSendNewChatMessage]);

  const handleSelectChat = (id: string) => {
    setIsNewChatMode(false);
    setNewChatStableKey(null);
    setActiveChatId(id);
  };

  const chatInterfaceKey = useMemo(() => {
    // Prioritize newChatStableKey to prevent component remount during new chat creation
    if (newChatStableKey) return newChatStableKey;
    if (activeChat) return activeChat.stableKey;
    return "default-chat";
  }, [activeChat?.stableKey, newChatStableKey]);

  // Get messages from either activeChat or pending chat
  const currentMessages = useMemo(() => {
    if (activeChat?.messages) return activeChat.messages;
    // Check if there's a pending chat with messages
    const pendingId = pendingChatIdRef.current;
    if (pendingId) {
      const pendingChat = chats.find(c => c.id === pendingId);
      if (pendingChat?.messages) return pendingChat.messages;
    }
    return [];
  }, [activeChat?.messages, chats]);

  const handleOpenGpts = () => {
    setIsGptExplorerOpen(true);
  };

  const handleOpenApps = () => {
    setIsAppsDialogOpen(true);
  };

  const handleOpenLibrary = () => {
    setIsLibraryOpen(true);
  };

  const handleSelectGpt = (gpt: Gpt) => {
    setActiveGpt(gpt);
    handleNewChat();
    toast.success(`Usando ${gpt.name}`);
  };

  const handleCreateGpt = () => {
    setEditingGpt(null);
    setIsGptBuilderOpen(true);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative">
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
          onOpenGpts={handleOpenGpts}
          onOpenApps={handleOpenApps}
          onOpenLibrary={handleOpenLibrary}
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
            <Button variant="ghost" size="icon" className="bg-card border border-border rounded-lg">
              <Menu className="h-6 w-6 text-foreground" />
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
              onOpenGpts={handleOpenGpts}
              onOpenApps={handleOpenApps}
              onOpenLibrary={handleOpenLibrary}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full w-full">
        {isAppsDialogOpen ? (
          <AppsView 
            onClose={() => setIsAppsDialogOpen(false)}
          />
        ) : (activeChat || isNewChatMode || chats.length === 0) && (
          <ChatInterface 
            key={chatInterfaceKey} 
            messages={currentMessages}
            onSendMessage={handleSendMessage}
            isSidebarOpen={isSidebarOpen} 
            onToggleSidebar={() => setIsSidebarOpen(true)}
            onCloseSidebar={() => setIsSidebarOpen(false)}
            activeGpt={activeGpt}
            aiState={aiState}
            setAiState={setAiState}
            aiProcessSteps={aiProcessSteps}
            setAiProcessSteps={setAiProcessSteps}
            chatId={activeChat?.id || null}
            onOpenApps={handleOpenApps}
          />
        )}
      </main>

      {/* GPT Explorer Modal */}
      <GptExplorer
        open={isGptExplorerOpen}
        onOpenChange={setIsGptExplorerOpen}
        onSelectGpt={handleSelectGpt}
        onCreateGpt={handleCreateGpt}
      />

      {/* GPT Builder Modal */}
      <GptBuilder
        open={isGptBuilderOpen}
        onOpenChange={setIsGptBuilderOpen}
        editingGpt={editingGpt}
        onSave={() => {
          setIsGptBuilderOpen(false);
          setEditingGpt(null);
        }}
      />

      {/* User Library Modal */}
      <UserLibrary
        open={isLibraryOpen}
        onOpenChange={setIsLibraryOpen}
      />
    </div>
  );
}
