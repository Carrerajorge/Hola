import { Sidebar } from "@/components/sidebar";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { GptExplorer, Gpt } from "@/components/gpt-explorer";
import { GptBuilder } from "@/components/gpt-builder";
import { UserLibrary } from "@/components/user-library";
import { AppsView } from "@/components/apps-view";
import { SearchModal } from "@/components/search-modal";
import { SettingsDialog } from "@/components/settings-dialog";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { ExportChatDialog } from "@/components/export-chat-dialog";
import { FavoritesDialog } from "@/components/favorites-dialog";
import { PromptTemplatesDialog } from "@/components/prompt-templates-dialog";
import { OfflineIndicator, OfflineBanner } from "@/components/offline-indicator";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useFavorites } from "@/hooks/use-favorites";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import { useNotifications } from "@/hooks/use-notifications";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useChats, Message } from "@/hooks/use-chats";
import { useChatFolders } from "@/hooks/use-chat-folders";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useStreamingStore, useProcessingChatIds, usePendingBadges } from "@/stores/streamingStore";

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [editingGpt, setEditingGpt] = useState<Gpt | null>(null);
  const [activeGpt, setActiveGpt] = useState<Gpt | null>(null);
  
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavorites();
  const { templates, addTemplate, removeTemplate, updateTemplate, incrementUsage, categories } = usePromptTemplates();
  const { notifyTaskComplete, requestPermission } = useNotifications();
  const { isOnline } = useOnlineStatus();
  
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
    hideChat,
    updateMessageAttachments,
    editMessageAndTruncate,
    truncateAndReplaceMessage,
    truncateMessagesAt
  } = useChats();

  const {
    folders,
    createFolder,
    moveChatToFolder,
    removeChatFromFolder
  } = useChatFolders();

  const handleMoveToFolder = useCallback((chatId: string, folderId: string | null) => {
    if (folderId === null) {
      removeChatFromFolder(chatId);
    } else {
      moveChatToFolder(chatId, folderId);
    }
  }, [moveChatToFolder, removeChatFromFolder]);

  // AI processing state - kept in parent to survive ChatInterface key changes
  const [aiState, setAiState] = useState<"idle" | "thinking" | "responding">("idle");
  const [aiProcessSteps, setAiProcessSteps] = useState<{step: string; status: "pending" | "active" | "done"}[]>([]);
  
  // Use global streaming store for tracking processing chats and pending badges
  const processingChatIds = useProcessingChatIds();
  const pendingResponseCounts = usePendingBadges();
  const { clearBadge } = useStreamingStore();

  // Store the pending chat ID during new chat creation
  const pendingChatIdRef = useRef<string | null>(null);
  
  const handleClearPendingCount = useCallback((chatId: string) => {
    clearBadge(chatId);
  }, [clearBadge]);
  
  // Clear pending count when selecting a chat
  const handleSelectChatWithClear = useCallback((id: string) => {
    // Keep processing state for background chats - don't clear processingChatIds
    // This allows multiple chats to process simultaneously
    handleClearPendingCount(id);
    setIsNewChatMode(false);
    setNewChatStableKey(null);
    setActiveChatId(id);
    // DON'T clear processingChatIdRef or call setAiState("idle") here
    // Let the background streaming complete naturally and trigger badge notification
    // Only reset the process steps for UI (not aiState - that's per-chat streaming)
    setAiProcessSteps([]);
  }, [handleClearPendingCount, setActiveChatId, setAiProcessSteps]);

  const handleNewChat = () => {
    // Keep processing state for background chats - don't clear processingChatIds
    // The previous chat will continue streaming in the background
    const newKey = `new-chat-${Date.now()}`;
    setActiveChatId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(newKey);
    pendingChatIdRef.current = null;
    // DON'T clear processingChatIdRef or call setAiState("idle") here
    // Let the background streaming complete naturally and trigger badge notification
    // Only reset the process steps for UI
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
  const handleSendMessage = useCallback(async (message: Message) => {
    const targetChatId = activeChat?.id || pendingChatIdRef.current;
    if (targetChatId) {
      return await addMessage(targetChatId, message);
    } else {
      // Fallback: create new chat
      handleSendNewChatMessage(message);
      return undefined;
    }
  }, [activeChat?.id, addMessage, handleSendNewChatMessage]);


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

  const handleOpenSkills = () => {
    setLocation("/skills");
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

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "n",
      ctrl: true,
      description: "Nuevo chat",
      action: () => handleNewChat(),
    },
    {
      key: "k",
      ctrl: true,
      description: "Búsqueda rápida",
      action: () => setIsSearchOpen(true),
    },
    {
      key: ",",
      ctrl: true,
      description: "Configuración",
      action: () => setIsSettingsOpen(true),
    },
    {
      key: "e",
      ctrl: true,
      description: "Exportar chat",
      action: () => {
        if (activeChat || currentMessages.length > 0) {
          setIsExportOpen(true);
        }
      },
    },
    {
      key: "/",
      ctrl: true,
      description: "Mostrar atajos",
      action: () => setIsShortcutsOpen(true),
    },
    {
      key: "t",
      ctrl: true,
      description: "Plantillas de prompts",
      action: () => setIsTemplatesOpen(true),
    },
    {
      key: "f",
      ctrl: true,
      shift: true,
      description: "Favoritos",
      action: () => setIsFavoritesOpen(true),
    },
    {
      key: "Escape",
      description: "Cerrar diálogo",
      action: () => {
        setIsSearchOpen(false);
        setIsSettingsOpen(false);
        setIsShortcutsOpen(false);
        setIsExportOpen(false);
        setIsGptExplorerOpen(false);
        setIsLibraryOpen(false);
        setIsFavoritesOpen(false);
        setIsTemplatesOpen(false);
      },
    },
  ]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative">
      <OfflineBanner />
      <div className="liquid-blob liquid-blob-1 opacity-30"></div>
      <div className="liquid-blob liquid-blob-2 opacity-20"></div>
      <div className="liquid-blob liquid-blob-3 opacity-25"></div>
      
      {/* Desktop Sidebar - Full */}
      <div className={isSidebarOpen ? "hidden md:block" : "hidden"}>
        <Sidebar 
          chats={chats} 
          hiddenChats={hiddenChats}
          activeChatId={activeChat?.id || null} 
          onSelectChat={handleSelectChatWithClear} 
          onNewChat={handleNewChat} 
          onToggle={() => setIsSidebarOpen(false)} 
          onDeleteChat={deleteChat}
          onEditChat={editChatTitle}
          onArchiveChat={archiveChat}
          onHideChat={hideChat}
          onOpenGpts={handleOpenGpts}
          onOpenApps={handleOpenApps}
          onOpenSkills={handleOpenSkills}
          onOpenLibrary={handleOpenLibrary}
          processingChatIds={processingChatIds}
          pendingResponseCounts={pendingResponseCounts}
          onClearPendingCount={handleClearPendingCount}
          folders={folders}
          onCreateFolder={createFolder}
          onMoveToFolder={handleMoveToFolder}
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
              onSelectChat={handleSelectChatWithClear} 
              onNewChat={handleNewChat} 
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
              onDeleteChat={deleteChat}
              onEditChat={editChatTitle}
              onArchiveChat={archiveChat}
              onHideChat={hideChat}
              onOpenGpts={handleOpenGpts}
              onOpenApps={handleOpenApps}
              onOpenSkills={handleOpenSkills}
              onOpenLibrary={handleOpenLibrary}
              processingChatIds={processingChatIds}
              pendingResponseCounts={pendingResponseCounts}
              onClearPendingCount={handleClearPendingCount}
              folders={folders}
              onCreateFolder={createFolder}
              onMoveToFolder={handleMoveToFolder}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full w-full">
        {isAppsDialogOpen ? (
          <AppsView 
            onClose={() => setIsAppsDialogOpen(false)}
            onOpenGmail={() => {
              setIsAppsDialogOpen(false);
            }}
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
            chatId={activeChat?.id || pendingChatIdRef.current || null}
            onOpenApps={handleOpenApps}
            onUpdateMessageAttachments={updateMessageAttachments}
            onEditMessageAndTruncate={editMessageAndTruncate}
            onTruncateAndReplaceMessage={truncateAndReplaceMessage}
            onTruncateMessagesAt={truncateMessagesAt}
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

      {/* Search Modal */}
      <SearchModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        chats={chats}
        onSelectChat={handleSelectChatWithClear}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={isShortcutsOpen}
        onOpenChange={setIsShortcutsOpen}
      />

      {/* Export Chat Dialog */}
      <ExportChatDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        chatTitle={activeChat?.title || "Conversación"}
        messages={currentMessages}
      />

      {/* Favorites Dialog */}
      <FavoritesDialog
        open={isFavoritesOpen}
        onOpenChange={setIsFavoritesOpen}
        favorites={favorites}
        onRemove={removeFavorite}
        onSelect={handleSelectChatWithClear}
      />

      {/* Prompt Templates Dialog */}
      <PromptTemplatesDialog
        open={isTemplatesOpen}
        onOpenChange={setIsTemplatesOpen}
        templates={templates}
        categories={categories}
        onAdd={addTemplate}
        onRemove={removeTemplate}
        onUpdate={updateTemplate}
        onSelect={setPendingPrompt}
        onIncrementUsage={incrementUsage}
      />
    </div>
  );
}
