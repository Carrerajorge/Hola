import { Sidebar } from "@/components/sidebar";
import { SkeletonPage } from "@/components/skeletons";
import { MiniSidebar } from "@/components/mini-sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { ChatErrorBoundary } from "@/components/error-boundaries";
// Re-deploy: override manual hotfix-20260220-051334 with git-tracked code
import type { Gpt } from "@/components/gpt-explorer";
import { OfflineIndicator, OfflineBanner } from "@/components/offline-indicator";
import { useMediaLibrary } from "@/hooks/use-media-library";
import { lazy, Suspense, useState, useCallback, useMemo, useEffect, useRef, type ComponentType } from "react";

import { useFavorites } from "@/hooks/use-favorites";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import { useNotifications } from "@/hooks/use-notifications";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation, useSearch } from "wouter";
import { Loader2, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useChats, Message, generateRequestId, resolveRealChatId } from "@/hooks/use-chats";
import { useChatFolders } from "@/hooks/use-chat-folders";
import { usePinnedGpts } from "@/hooks/use-pinned-gpts";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useStreamingStore, useProcessingChatIds, usePendingBadges } from "@/stores/streamingStore";
import { useAgentStore } from "@/stores/agent-store";
import { useSuperAgentStore } from "@/stores/super-agent-store";
import { pollingManager } from "@/lib/polling-manager";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/apiClient";
import { normalizeAppBuildVersion, recoverFromChunkError } from "@/lib/chunk-recovery";

const isLocalDevHost = () => {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
};

const APP_VERSION = normalizeAppBuildVersion(import.meta.env.VITE_APP_VERSION);
const LazyRecoveryFallback = (() => null) as ComponentType<any>;

const lazyWithRetry = <T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      if (typeof window !== "undefined") {
        const recovered = await recoverFromChunkError(error, APP_VERSION);
        if (recovered) {
          return { default: LazyRecoveryFallback as T };
        }
      }
      throw error;
    }
  });

const AppsViewLazy = lazyWithRetry(() => import("@/components/apps-view").then((m) => ({ default: m.AppsView })));
const ChannelsHubDialogLazy = lazyWithRetry(() =>
  import("@/components/channels-hub-dialog").then((m) => ({ default: m.ChannelsHubDialog }))
);
import { whatsappWebEventStream } from "@/lib/whatsapp-web-events";
const GptExplorerLazy = lazyWithRetry(() => import("@/components/gpt-explorer").then((m) => ({ default: m.GptExplorer })));
const AboutGptDialogLazy = lazyWithRetry(() =>
  import("@/components/about-gpt-dialog").then((m) => ({ default: m.AboutGptDialog }))
);
const GptBuilderLazy = lazyWithRetry(() => import("@/components/gpt-builder").then((m) => ({ default: m.GptBuilder })));
const UserLibraryLazy = lazyWithRetry(() => import("@/components/user-library").then((m) => ({ default: m.UserLibrary })));
const SearchModalLazy = lazyWithRetry(() => import("@/components/search-modal").then((m) => ({ default: m.SearchModal })));
const SettingsDialogLazy = lazyWithRetry(() => import("@/components/settings-dialog").then((m) => ({ default: m.SettingsDialog })));
const KeyboardShortcutsDialogLazy = lazyWithRetry(() =>
  import("@/components/keyboard-shortcuts-dialog").then((m) => ({ default: m.KeyboardShortcutsDialog }))
);
const ExportChatDialogLazy = lazyWithRetry(() =>
  import("@/components/export-chat-dialog").then((m) => ({ default: m.ExportChatDialog }))
);
const FavoritesDialogLazy = lazyWithRetry(() =>
  import("@/components/favorites-dialog").then((m) => ({ default: m.FavoritesDialog }))
);
const PromptTemplatesDialogLazy = lazyWithRetry(() =>
  import("@/components/prompt-templates-dialog").then((m) => ({ default: m.PromptTemplatesDialog }))
);

export default function Home() {
  const isMobile = useIsMobile();
  const [location, setLocation] = useLocation();
  const { user, isLoading, isReady } = useAuth();


  useEffect(() => {
    // Keep login requirement outside local development host.
    if (isReady && !isLoading && !user && !isLocalDevHost()) {
      setLocation("/welcome");
    }
  }, [user, isLoading, isReady, setLocation]);

  // After OAuth login with provider_hint, auto-trigger the provider connection dialog.
  // The server redirects to /?auth=success&provider=gemini (or openai) after Google OAuth.
  useEffect(() => {
    if (!isReady || !user) return;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    if (provider === "gemini" || provider === "openai") {
      // Clean up URL first
      params.delete("provider");
      params.delete("auth");
      const rest = params.toString();
      window.history.replaceState({}, "", rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
      // Dispatch event so provider dialogs can auto-open
      // Small delay to let components mount first
      const timer = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("auto-connect-provider", { detail: { provider } }));
      }, 600);
      return () => window.clearTimeout(timer);
    }
  }, [isReady, user]);

  useEffect(() => {
    const preload = () => {
      void useMediaLibrary.getState().preload();
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(() => preload(), { timeout: 2000 });
      return () => {
        if (typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = window.setTimeout(preload, 350);
    return () => window.clearTimeout(timeoutId);
  }, []);


  // Parse chat id from URL: /chat/:id

  const chatIdFromUrl = useMemo(() => {

    const m = location.match(/^\/chat\/([^/?#]+)/);

    return m ? decodeURIComponent(m[1]) : null;

  }, [location]);




  const [isSidebarOpen, setIsSidebarOpen] = useState(!isMobile);
  const [isNewChatMode, setIsNewChatMode] = useState(false);
  const [newChatStableKey, setNewChatStableKey] = useState<string | null>(null);
  const [newChatResetNonce, setNewChatResetNonce] = useState(0);
  const [isGptExplorerOpen, setIsGptExplorerOpen] = useState(false);
  const [isGptBuilderOpen, setIsGptBuilderOpen] = useState(false);
  const [aboutGptId, setAboutGptId] = useState<string | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isAppsDialogOpen, setIsAppsDialogOpen] = useState(false);
  const [isWhatsAppConnectOpen, setIsWhatsAppConnectOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [editingGpt, setEditingGpt] = useState<Gpt | null>(null);
  const [activeGpt, setActiveGpt] = useState<Gpt | null>(null);
  const gptCacheRef = useRef<Map<string, Gpt>>(new Map());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const activeGptId = useMemo(() => {
    const raw = typeof activeGpt?.id === "string" ? activeGpt.id.trim() : "";
    return raw.length > 0 ? raw : null;
  }, [activeGpt?.id]);

  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavorites();
  const { templates, addTemplate, removeTemplate, updateTemplate, incrementUsage, categories } = usePromptTemplates();
  const { notifyTaskComplete, requestPermission } = useNotifications();
  const { isOnline } = useOnlineStatus();

  const {
    chats,
    hiddenChats,
    pinnedChats,
    activeChat,
    setActiveChatId,
    createChat,
    addMessage,
    deleteChat,
    editChatTitle,
    archiveChat,
    hideChat,
    pinChat,
    downloadChat,
    updateMessageAttachments,
    editMessageAndTruncate,
    truncateAndReplaceMessage,
    truncateMessagesAt,
    isLoading: isChatsLoading
  } = useChats();

  const activeChatGptId = useMemo(() => {
    const raw = typeof (activeChat as any)?.gptId === "string" ? (activeChat as any).gptId.trim() : "";
    return raw.length > 0 ? raw : null;
  }, [activeChat]);

  useEffect(() => {
    const currentChatId = activeChat?.id;
    if (!currentChatId) return;

    if (!activeChatGptId) {
      setActiveGpt((prev) => (prev ? null : prev));
      return;
    }

    if (activeGpt?.id === activeChatGptId) {
      return;
    }

    const cached = gptCacheRef.current.get(activeChatGptId);
    if (cached) {
      setActiveGpt(cached);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch(`/api/gpts/${activeChatGptId}`);
        if (!response.ok) return;
        const gpt = await response.json();
        if (cancelled || !gpt?.id) return;
        gptCacheRef.current.set(gpt.id, gpt);
        setActiveGpt(gpt);
      } catch (error) {
        console.warn("[home] Failed to recover GPT context from active chat:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChat?.id, activeChatGptId, activeGpt?.id]);

  const {
    folders,
    createFolder,
    moveChatToFolder,
    removeChatFromFolder,
    getFolderForChat
  } = useChatFolders();

  const handleMoveToFolder = useCallback((chatId: string, folderId: string | null) => {
    if (folderId === null) {
      removeChatFromFolder(chatId);
    } else {
      moveChatToFolder(chatId, folderId);
    }
  }, [moveChatToFolder, removeChatFromFolder]);

  type HomeAiState = "idle" | "thinking" | "responding" | "agent_working";
  type HomeAiStep = { step: string; status: "pending" | "active" | "done" };
  type HomeConversationUiState = {
    aiState: HomeAiState;
    aiProcessSteps: HomeAiStep[];
    pendingRequestId: string | null;
    streamBuffer: string;
  };

  const createHomeConversationUiState = (): HomeConversationUiState => ({
    aiState: "idle",
    aiProcessSteps: [],
    pendingRequestId: null,
    streamBuffer: "",
  });

  const [conversationUiStateMap, setConversationUiStateMap] = useState<Record<string, HomeConversationUiState>>({});

  // Super Agent UI state - kept in parent to survive ChatInterface key changes
  const [uiPhase, setUiPhase] = useState<'idle' | 'thinking' | 'console' | 'done'>('idle');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Document generation state - kept in parent to survive ChatInterface key changes during new chat creation
  const [selectedDocTool, setSelectedDocTool] = useState<"word" | "excel" | "ppt" | "figma" | null>(null);
  const [docGenerationState, setDocGenerationState] = useState<{
    status: 'idle' | 'generating' | 'ready' | 'error';
    progress: number;
    stage: string;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    error?: string;
  }>({ status: 'idle', progress: 0, stage: '', downloadUrl: null, fileName: null, fileSize: null });

  // URL Persistence for Simulator/Plan (B4)
  // Read planId from URL on mount/navigation only — avoid circular deps
  // by NOT including activeRunId/uiPhase in the restore effect deps.
  const search = useSearch();
  const activeRunIdRef = useRef(activeRunId);
  activeRunIdRef.current = activeRunId;
  const uiPhaseRef = useRef(uiPhase);
  uiPhaseRef.current = uiPhase;

  useEffect(() => {
    const params = new URLSearchParams(search);
    const planId = params.get("planId");

    if (planId && planId !== activeRunIdRef.current) {
      setUiPhase('console');
      setActiveRunId(planId);
    } else if (!planId && activeRunIdRef.current && uiPhaseRef.current === 'console') {
      setUiPhase('idle');
      setActiveRunId(null);
    }
  }, [search]);

  // Update URL when activeRunId changes — one-way data flow (state → URL)
  useEffect(() => {
    if (activeRunId && uiPhase === 'console') {
      const url = new URL(window.location.href);
      url.searchParams.set("planId", activeRunId);
      window.history.replaceState({}, "", url.toString());
    } else {
      const url = new URL(window.location.href);
      if (url.searchParams.has("planId")) {
        url.searchParams.delete("planId");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [activeRunId, uiPhase]);

  // Use global streaming store for tracking processing chats and pending badges
  const processingChatIds = useProcessingChatIds();
  const pendingResponseCounts = usePendingBadges();
  const { clearBadge } = useStreamingStore();

  // WhatsApp: listen for mirrored messages and inject chats into the sidebar in real-time.
  const lastWaRefreshRef = useRef(0);
  useEffect(() => {
    const unsub = whatsappWebEventStream.subscribe({
      onMessage: () => {
        // Throttle: at most one refresh every 3 seconds to avoid hammering the API
        const now = Date.now();
        if (now - lastWaRefreshRef.current < 3000) return;
        lastWaRefreshRef.current = now;
        window.dispatchEvent(new Event("refresh-chats"));
      },
    });
    return unsub;
  }, []);

  // Store the pending chat ID during new chat creation
  const pendingChatIdRef = useRef<string | null>(null);

  const ensureConversationUiState = useCallback((conversationId: string | null | undefined) => {
    if (!conversationId) return;
    setConversationUiStateMap((prev) => {
      if (prev[conversationId]) return prev;
      return { ...prev, [conversationId]: createHomeConversationUiState() };
    });
  }, []);

  const moveConversationUiState = useCallback((fromConversationId?: string | null, toConversationId?: string | null) => {
    if (!fromConversationId || !toConversationId || fromConversationId === toConversationId) return;
    setConversationUiStateMap((prev) => {
      const sourceState = prev[fromConversationId];
      if (!sourceState) return prev;
      const { [fromConversationId]: _, ...rest } = prev;
      if (rest[toConversationId]) return rest;
      return { ...rest, [toConversationId]: sourceState };
    });
  }, []);

  const activeConversationId = useMemo(() => {
    if (activeChat?.id) return activeChat.id;
    if (pendingChatIdRef.current) return pendingChatIdRef.current;
    if (isNewChatMode && newChatStableKey) return newChatStableKey;
    return null;
  }, [activeChat?.id, isNewChatMode, newChatStableKey]);

  useEffect(() => {
    ensureConversationUiState(activeConversationId);
  }, [activeConversationId, ensureConversationUiState]);

  const activeConversationState = activeConversationId
    ? conversationUiStateMap[activeConversationId]
    : undefined;

  const aiState: HomeAiState = activeConversationState?.aiState || "idle";
  const aiProcessSteps: HomeAiStep[] = activeConversationState?.aiProcessSteps || [];
  const aiStateChatId = aiState === "idle" ? null : activeConversationId;

  const setAiState = useCallback((newState: HomeAiState | ((prev: HomeAiState) => HomeAiState)) => {
    const targetConversationId = activeConversationId || pendingChatIdRef.current || newChatStableKey;
    if (!targetConversationId) return;
    setConversationUiStateMap((prev) => {
      const current = prev[targetConversationId] || createHomeConversationUiState();
      const resolvedState = typeof newState === "function"
        ? (newState as (prev: HomeAiState) => HomeAiState)(current.aiState)
        : newState;
      return {
        ...prev,
        [targetConversationId]: {
          ...current,
          aiState: resolvedState,
          aiProcessSteps: resolvedState === "idle" ? [] : current.aiProcessSteps,
        },
      };
    });
  }, [activeConversationId, newChatStableKey]);

  const setAiProcessSteps = useCallback((nextSteps: HomeAiStep[] | ((prev: HomeAiStep[]) => HomeAiStep[])) => {
    const targetConversationId = activeConversationId || pendingChatIdRef.current || newChatStableKey;
    if (!targetConversationId) return;
    setConversationUiStateMap((prev) => {
      const current = prev[targetConversationId] || createHomeConversationUiState();
      const resolvedSteps = typeof nextSteps === "function"
        ? (nextSteps as (prev: HomeAiStep[]) => HomeAiStep[])(current.aiProcessSteps)
        : nextSteps;
      return {
        ...prev,
        [targetConversationId]: {
          ...current,
          aiProcessSteps: resolvedSteps,
        },
      };
    });
  }, [activeConversationId, newChatStableKey]);


  // Sync URL to active chat state (direct navigation to /chat/:id)

  useEffect(() => {

    if (!chatIdFromUrl) return;

    if (activeChat?.id === chatIdFromUrl) return;

    // Exit new chat mode and clear project selection

    setIsNewChatMode(false);

    // Only clear newChatStableKey if this navigation is NOT from our own
    // pending chat creation (handleSendNewChatMessage sets location after
    // creating the chat — clearing the key here would cause a remount
    // that kills the in-flight streaming request).
    const isPendingChatNavigation = pendingChatIdRef.current != null;
    if (!isPendingChatNavigation) {
      setNewChatStableKey(null);
    }

    // CRITICAL: Do NOT clear pendingChatIdRef when the URL change came from
    // our own new-chat flow (replaceState in handleSendNewChatMessage).
    // The ref is needed by stale closures in useStreamChat.finalize →
    // handleSendMessage to find the correct chat for the assistant response.
    // Clearing it here causes finalize to fall through to
    // handleSendNewChatMessage, creating a SECOND pending chat (split bug).
    if (!isPendingChatNavigation) {
      pendingChatIdRef.current = null;
    }

    setSelectedProjectId(null);

    setActiveChatId(chatIdFromUrl);

  }, [chatIdFromUrl, activeChat?.id, setActiveChatId]);




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
    setLocation(`/chat/${id}`);
    setSelectedProjectId(null); // Clear project selection when selecting a chat
  }, [handleClearPendingCount, setActiveChatId]);

  // Listen for select-chat custom event (used by Agent Mode navigation)
  // This event is used when agent creates a new chat - we need to preserve the stable key
  // to prevent component remount which would lose the agent run state
  useEffect(() => {
    const handleSelectChatEvent = (event: CustomEvent<{ chatId: string; preserveKey?: boolean }>) => {
      const { chatId, preserveKey } = event.detail;
      if (chatId) {
        // For agent mode navigation, don't reset the stable key - just update the active chat ID
        // This prevents component remount and preserves agent run state
        handleClearPendingCount(chatId);
        setIsNewChatMode(false);
        // Only reset stableKey if not preserving (for regular navigation)
        if (!preserveKey) {
          setNewChatStableKey(null);
        }
        setActiveChatId(chatId);
        setLocation(`/chat/${chatId}`, { replace: !!preserveKey });
      }
    };

    window.addEventListener("select-chat", handleSelectChatEvent as EventListener);
    return () => {
      window.removeEventListener("select-chat", handleSelectChatEvent as EventListener);
    };
  }, [handleClearPendingCount, setActiveChatId]);

  const handleNewChat = (options?: { preserveGpt?: boolean }) => {
    // TRANSACTIONAL RESET: Block all re-hydration for 5 seconds
    // This prevents stale state from coming back after navigation
    useAgentStore.getState().blockRehydration();

    // Clear all streaming badges and pending response indicators
    useStreamingStore.getState().clearAllBadges();

    // Clear all Super Agent runs
    useSuperAgentStore.getState().clearAllRuns();

    // Cancel all active agent runs and clear agent state
    pollingManager.cancelAll();
    useAgentStore.getState().clearAllRuns();

    // Clear conversation state query cache to prevent stale data
    queryClient.removeQueries({ queryKey: ['conversationState'] });

    // Reset Super Agent UI state
    setUiPhase('idle');
    setActiveRunId(null);

    // Reset document generation state
    setSelectedDocTool(null);
    setDocGenerationState({ status: 'idle', progress: 0, stage: '', downloadUrl: null, fileName: null, fileSize: null });

    // Clear chat references - this triggers new chat mode
    const newConversationId = `new-chat-${Date.now()}`;
    setNewChatResetNonce((prev) => prev + 1);
    setActiveChatId(null);
    setSelectedProjectId(null);
    setIsNewChatMode(true);
    setNewChatStableKey(newConversationId);
    ensureConversationUiState(newConversationId);
    pendingChatIdRef.current = null;

    // AGGRESSIVE RESET: Clear active GPT to return to LLM models view
    // Only clear GPT if not explicitly preserving it (e.g., when selecting a new GPT)
    if (!options?.preserveGpt) {
      setActiveGpt(null);
    }

    // Close any open dialogs
    setIsAppsDialogOpen(false);
    setLocation("/");
  };

  const handleSelectProject = useCallback((projectId: string) => {
    // Clear chat selection to show project welcome screen
    setActiveChatId(null);
    setIsNewChatMode(false);
    setNewChatStableKey(null);
    pendingChatIdRef.current = null;

    // Set selected project
    setSelectedProjectId(projectId);

    // Clear other UI states
    setActiveGpt(null);
  }, [setActiveChatId]);

  const handleSendNewChatMessage = useCallback(async (message: Message) => {
    const messageWithGptContext: Message = activeGptId && message.role === "user"
      ? {
        ...message,
        metadata: {
          ...(message.metadata || {}),
          gptId: activeGptId,
        },
      }
      : message;
    const { pendingId, stableKey } = createChat({ gptId: activeGptId });
    moveConversationUiState(newChatStableKey, pendingId);
    ensureConversationUiState(pendingId);
    pendingChatIdRef.current = pendingId;
    setNewChatStableKey(stableKey);
    setIsNewChatMode(false);
    const provisionalChatId = resolveRealChatId(pendingId);

    // Return the provisional real chatId immediately so the first stream can
    // start without waiting for the message-save round-trip.
    void addMessage(pendingId, messageWithGptContext)
      .then((result) => {
        const realId =
          result?.run?.chatId ||
          (result ? resolveRealChatId(pendingId) : provisionalChatId);
        if (realId && !realId.startsWith("pending-")) {
          moveConversationUiState(pendingId, realId);
          // addMessage already renames the chat entry and updates activeChatId,
          // but call setActiveChatId again as a safety net.
          setActiveChatId(realId);
          // Keep the ref pointing to the real ID so that stale closures in
          // useStreamChat.finalize → handleSendMessage can still find the correct
          // chat via pendingChatIdRef.current (refs are read by reference, not
          // captured by value like state).
          pendingChatIdRef.current = realId;
          // Silently update the URL bar without triggering wouter's router.
          window.history.replaceState(null, "", `/chat/${realId}`);
        }
      })
      .catch((error) => {
        console.error("[home] Failed to persist first message for new chat:", error);
      });

    return { chatId: provisionalChatId };
  }, [activeGptId, addMessage, createChat, ensureConversationUiState, moveConversationUiState, newChatStableKey, setActiveChatId]);

  // Stable message sender that uses the correct chat ID
  const handleSendMessage = useCallback(async (message: Message) => {
    if (import.meta.env.DEV) {
      console.debug("[home] handleSendMessage", {
        messageContent: message.content?.substring(0, 50),
        activeChat: activeChat?.id,
        pendingChatId: pendingChatIdRef.current,
      });
    }
    
    // Check for Simulator / Dry-Run command (B4)
    if (message.content.trim().startsWith('/plan ') || message.content.trim().startsWith('/preview ')) {
      const goal = message.content.replace(/^\/(plan|preview)\s+/, '').trim();

      // 1. Send user message first
      const targetChatId = activeChat?.id || pendingChatIdRef.current;
      let chatId = targetChatId;

      if (!chatId) {
        const { pendingId, stableKey } = createChat({ gptId: activeGptId });
        pendingChatIdRef.current = pendingId;
        setNewChatStableKey(stableKey);
        setIsNewChatMode(false);
        chatId = pendingId;
      }

      // Add user message
      const planUserMessage: Message = activeGptId && message.role === "user"
        ? {
          ...message,
          metadata: {
            ...(message.metadata || {}),
            gptId: activeGptId,
          },
        }
        : message;
      await addMessage(chatId!, planUserMessage);

      // 2. Call Preview API
      try {
        // Add a temporary "thinking" step or message? 
        // For now just fetch.
        const res = await apiFetch('/api/planning/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.preview?.plan) {
            // 3. Create Assistant Message with Plan
            const planMsg: Message = {
              id: generateRequestId(),
              role: 'assistant',
              content: `He generado un plan para: "${goal}". Revisa los pasos y ejecútalo cuando estés listo.`,
              timestamp: new Date(),
              agentRun: {
                runId: data.preview.plan.id,
                status: 'planning', // Supported status
                steps: [],
                eventStream: [],
                summary: null,
                error: null
              }
            };

            await addMessage(chatId!, planMsg);

            // Also initialize run in AgentStore so PlanViewer works correctly
            useAgentStore.getState().setRunId(planMsg.id, data.preview.plan.id, chatId!);
            // Manually force status to planning in store
            useAgentStore.getState().updateRun(planMsg.id, {
              status: 'planning',
              runId: data.preview.plan.id,
              chatId: chatId!
            });

          }
        }
      } catch (e) {
        console.error("Preview failed", e);
        // Add error message?
      }

      return;
    }

    const targetChatId = activeChat?.id || pendingChatIdRef.current;
    const messageWithGptContext: Message = activeGptId && message.role === "user"
      ? {
        ...message,
        metadata: {
          ...(message.metadata || {}),
          gptId: activeGptId,
        },
      }
      : message;
    if (targetChatId) {
      return await addMessage(targetChatId, messageWithGptContext);
    } else {
      // Fallback: create new chat
      return await handleSendNewChatMessage(messageWithGptContext);
    }
  }, [activeChat?.id, activeGptId, addMessage, handleSendNewChatMessage, createChat, addMessage]);

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

  // Dummy setMessages for ChatInterface - Agent Mode uses its own internal state
  // We pass messages as read-only from currentMessages
  const noopSetMessages = useCallback(() => {
    // No-op - Agent Mode will manage its own local state for real-time updates
  }, []);

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
    handleNewChat({ preserveGpt: true });
    toast.success(`Usando ${gpt.name}`);
  };

  const handleCreateGpt = () => {
    setEditingGpt(null);
    setIsGptBuilderOpen(true);
  };

  const handleEditGpt = useCallback(async (gptLike?: { id: string } | null) => {
    const targetId = gptLike?.id || activeGpt?.id;
    if (!targetId) return;

    try {
      const res = await apiFetch(`/api/gpts/${targetId}`);
      if (res.ok) {
        const fullGpt = await res.json();
        setEditingGpt(fullGpt);
        setIsGptBuilderOpen(true);
        return;
      }
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || "No se pudo cargar el GPT");
    } catch (error) {
      console.error("Error fetching GPT for edit:", error);
      toast.error("No se pudo abrir el editor del GPT");
    }
  }, [activeGpt]);

  const { isPinned, pinGpt, unpinGpt } = usePinnedGpts();

  const handleHideGptFromSidebar = async (gptId: string) => {
    try {
      await unpinGpt(gptId);
      toast.success("GPT ocultado de la barra lateral");
    } catch (error) {
      toast.error("Error al ocultar el GPT");
    }
  };

  const handlePinGptToSidebar = async (gptId: string) => {
    try {
      await pinGpt(gptId);
      toast.success("GPT fijado en la barra lateral");
    } catch (error) {
      toast.error("Error al fijar el GPT");
    }
  };

  const handleToggleGptPin = async (gptId: string) => {
    if (isPinned(gptId)) {
      await handleHideGptFromSidebar(gptId);
    } else {
      await handlePinGptToSidebar(gptId);
    }
  };

  const handleAboutGptFromChat = useCallback((gpt: { id: string; name: string; description: string | null }) => {
    setAboutGptId(gpt.id);
  }, []);

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

  if (isLoading || !isReady) {
    return <SkeletonPage />;
  }

  const showChatShellLoading = isChatsLoading && chats.length === 0;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background relative">
      <OfflineBanner />
      <div className="liquid-blob liquid-blob-1 opacity-30"></div>
      <div className="liquid-blob liquid-blob-2 opacity-20"></div>
      <div className="liquid-blob liquid-blob-3 opacity-25"></div>
      {showChatShellLoading ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#A5A0FF]/25 bg-background/88 px-4 py-2 text-sm text-muted-foreground shadow-lg shadow-[#A5A0FF]/10 backdrop-blur-xl">
            <Loader2 className="h-4 w-4 animate-spin text-[#756ef1]" />
            Sincronizando tus chats...
          </div>
        </div>
      ) : null}

      {!isMobile ? (
        <>
          {/* Desktop Sidebar - Full */}
          <div className={isSidebarOpen ? "hidden md:block" : "hidden"}>
            <Sidebar
              chats={chats}
              hiddenChats={hiddenChats}
              pinnedChats={pinnedChats}
              activeChatId={activeChat?.id || null}
              onSelectChat={handleSelectChatWithClear}
              onNewChat={handleNewChat}
              onToggle={() => setIsSidebarOpen(false)}
              onDeleteChat={deleteChat}
              onEditChat={editChatTitle}
              onArchiveChat={archiveChat}
              onHideChat={hideChat}
              onPinChat={pinChat}
              onDownloadChat={downloadChat}
              onOpenGpts={handleOpenGpts}
              onOpenApps={handleOpenApps}
              onOpenSkills={handleOpenSkills}
              onOpenWhatsAppConnect={() => setIsWhatsAppConnectOpen(true)}
              onOpenLibrary={handleOpenLibrary}
              processingChatIds={processingChatIds}
              pendingResponseCounts={pendingResponseCounts}
              onClearPendingCount={handleClearPendingCount}
              folders={folders}
              onCreateFolder={createFolder}
              onMoveToFolder={handleMoveToFolder}
              selectedProjectId={selectedProjectId}
              onSelectProject={handleSelectProject}
            />
          </div>

          {/* Desktop Sidebar - Mini (collapsed) */}
          <div className={!isSidebarOpen ? "hidden md:block" : "hidden"}>
            <MiniSidebar
              onNewChat={handleNewChat}
              onExpand={() => setIsSidebarOpen(true)}
            />
          </div>
        </>
      ) : (
        <div className="absolute top-4 left-3 z-50">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="bg-card border border-border rounded-lg mt-[-9px] mb-[-9px] ml-[-5px] mr-[-5px]">
                <Menu className="h-6 w-6 text-foreground" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[260px]">
              <Sidebar
                chats={chats}
                hiddenChats={hiddenChats}
                pinnedChats={pinnedChats}
                activeChatId={activeChat?.id || null}
                onSelectChat={handleSelectChatWithClear}
                onNewChat={handleNewChat}
                onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                onDeleteChat={deleteChat}
                onEditChat={editChatTitle}
                onArchiveChat={archiveChat}
                onHideChat={hideChat}
                onPinChat={pinChat}
                onDownloadChat={downloadChat}
                onOpenGpts={handleOpenGpts}
                onOpenApps={handleOpenApps}
                onOpenSkills={handleOpenSkills}
                onOpenWhatsAppConnect={() => setIsWhatsAppConnectOpen(true)}
                onOpenLibrary={handleOpenLibrary}
                processingChatIds={processingChatIds}
                pendingResponseCounts={pendingResponseCounts}
                onClearPendingCount={handleClearPendingCount}
                folders={folders}
                onCreateFolder={createFolder}
                onMoveToFolder={handleMoveToFolder}
                selectedProjectId={selectedProjectId}
                onSelectProject={handleSelectProject}
              />
            </SheetContent>
          </Sheet>
        </div>
      )}

      <Suspense fallback={null}>
        {isWhatsAppConnectOpen ? (
          <ChannelsHubDialogLazy
            open={isWhatsAppConnectOpen}
            onOpenChange={(next) => {
              setIsWhatsAppConnectOpen(next);
            }}
          />
        ) : null}
      </Suspense>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full w-full min-h-0">
        {isAppsDialogOpen ? (
          <Suspense fallback={<SkeletonPage />}>
            <AppsViewLazy
              onClose={() => setIsAppsDialogOpen(false)}
              onOpenGmail={() => {
                setIsAppsDialogOpen(false);
              }}
            />
          </Suspense>
        ) : (
          <ChatErrorBoundary>
            <ChatInterface
              messages={currentMessages}
              setMessages={noopSetMessages}
              onSendMessage={handleSendMessage}
              onSendMessageToChat={addMessage}
              isSidebarOpen={isSidebarOpen}
              onToggleSidebar={() => setIsSidebarOpen(true)}
              onCloseSidebar={() => setIsSidebarOpen(false)}
              activeGpt={activeGpt}
              aiState={aiState}
            setAiState={setAiState}
            aiStateChatId={aiStateChatId}
            aiProcessSteps={aiProcessSteps}
            setAiProcessSteps={setAiProcessSteps}
              chatId={activeChat?.id || pendingChatIdRef.current || null}
              chatGptId={activeChatGptId}
              onOpenApps={handleOpenApps}
            onUpdateMessageAttachments={updateMessageAttachments}
            onEditMessageAndTruncate={editMessageAndTruncate}
            onTruncateAndReplaceMessage={truncateAndReplaceMessage}
            onTruncateMessagesAt={truncateMessagesAt}
            onNewChat={handleNewChat}
            onEditGpt={handleEditGpt}
            onHideGptFromSidebar={handleHideGptFromSidebar}
            onPinGptToSidebar={handlePinGptToSidebar}
            isGptPinned={isPinned}
            onAboutGpt={handleAboutGptFromChat}
            onPinChat={pinChat}
            onArchiveChat={archiveChat}
            onHideChat={hideChat}
            onDeleteChat={deleteChat}
            onDownloadChat={downloadChat}
            onEditChatTitle={editChatTitle}
            isPinned={!!activeChat?.pinned}
            isArchived={!!activeChat?.archived}
            folders={folders}
            onMoveToFolder={handleMoveToFolder}
            onCreateFolder={createFolder}
            currentFolderId={activeChat?.id ? getFolderForChat(activeChat.id)?.id || null : null}
            uiPhase={uiPhase}
            setUiPhase={setUiPhase}
            activeRunId={activeRunId}
            setActiveRunId={setActiveRunId}
            selectedProjectId={selectedProjectId}
            selectedDocTool={selectedDocTool}
            setSelectedDocTool={setSelectedDocTool}
            docGenerationState={docGenerationState}
            setDocGenerationState={setDocGenerationState}
            newChatResetNonce={newChatResetNonce}
          />
          </ChatErrorBoundary>
        )}
      </main>

      {/* GPT Explorer Modal */}
      
      <Suspense fallback={null}>
        {isGptExplorerOpen ? (
          <GptExplorerLazy
            open={isGptExplorerOpen}
            onOpenChange={setIsGptExplorerOpen}
            onSelectGpt={handleSelectGpt}
            onCreateGpt={handleCreateGpt}
            onEditGpt={handleEditGpt}
          />
        ) : null}
      </Suspense>
      

      {/* About GPT Dialog */}
      <Suspense fallback={null}>
        {aboutGptId ? (
          <AboutGptDialogLazy
            open={!!aboutGptId}
            onOpenChange={(open) => !open && setAboutGptId(null)}
            gptId={aboutGptId}
            onSelectGpt={async (gpt) => {
              setAboutGptId(null);
              try {
                const res = await apiFetch(`/api/gpts/${gpt.id}`);
                if (res.ok) {
                  const fullGpt = await res.json();
                  handleSelectGpt(fullGpt);
                }
              } catch (error) {
                console.error("Error fetching GPT:", error);
              }
            }}
            onEditGpt={() => {
              setAboutGptId(null);
              handleEditGpt(activeGpt);
            }}
            onCopyLink={() => {
              if (aboutGptId) {
                navigator.clipboard.writeText(`${window.location.origin}/gpts/${aboutGptId}`);
                toast.success("Enlace copiado al portapapeles");
              }
            }}
          />
        ) : null}
      </Suspense>

      {/* GPT Builder Modal */}
      
      <Suspense fallback={null}>
        {isGptBuilderOpen ? (
          <GptBuilderLazy
            open={isGptBuilderOpen}
            onOpenChange={setIsGptBuilderOpen}
            editingGpt={editingGpt}
            onSave={() => {
              setIsGptBuilderOpen(false);
              setEditingGpt(null);
            }}
          />
        ) : null}
      </Suspense>
      

      {/* User Library Modal */}
      
      <Suspense fallback={null}>
        {isLibraryOpen ? (
          <UserLibraryLazy open={isLibraryOpen} onOpenChange={setIsLibraryOpen} />
        ) : null}
      </Suspense>

      {/* Search Modal */}
      <Suspense fallback={null}>
        {isSearchOpen ? (
          <SearchModalLazy
            open={isSearchOpen}
            onOpenChange={setIsSearchOpen}
            chats={chats}
            onSelectChat={handleSelectChatWithClear}
          />
        ) : null}
      </Suspense>

      {/* Settings Dialog */}
      
      <Suspense fallback={null}>
        {isSettingsOpen ? (
          <SettingsDialogLazy open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
        ) : null}
      </Suspense>
      

      {/* Keyboard Shortcuts Dialog */}
      <Suspense fallback={null}>
        {isShortcutsOpen ? (
          <KeyboardShortcutsDialogLazy open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />
        ) : null}
      </Suspense>

      {/* Export Chat Dialog */}
      <Suspense fallback={null}>
        {isExportOpen ? (
          <ExportChatDialogLazy
            open={isExportOpen}
            onOpenChange={setIsExportOpen}
            chatTitle={activeChat?.title || "Conversación"}
            messages={currentMessages}
          />
        ) : null}
      </Suspense>

      {/* Favorites Dialog */}
      <Suspense fallback={null}>
        {isFavoritesOpen ? (
          <FavoritesDialogLazy
            open={isFavoritesOpen}
            onOpenChange={setIsFavoritesOpen}
            favorites={favorites}
            onRemove={removeFavorite}
            onSelect={handleSelectChatWithClear}
          />
        ) : null}
      </Suspense>

      {/* Prompt Templates Dialog */}
      <Suspense fallback={null}>
        {isTemplatesOpen ? (
          <PromptTemplatesDialogLazy
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
        ) : null}
      </Suspense>

    </div>
  );
}
