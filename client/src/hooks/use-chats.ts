import { useState, useEffect, useCallback } from "react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";

export interface FigmaDiagram {
  nodes: Array<{
    id: string;
    type: "start" | "end" | "process" | "decision";
    label: string;
    x: number;
    y: number;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
  title?: string;
}

export interface GoogleFormPreview {
  prompt: string;
  fileContext?: Array<{ name: string; content: string; type: string }>;
  autoStart?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  steps?: { title: string; status: "pending" | "loading" | "complete" }[];
  attachments?: { type: "word" | "excel" | "ppt" | "image" | "pdf" | "text" | "code" | "archive" | "unknown"; name: string; mimeType?: string; imageUrl?: string; storagePath?: string; fileId?: string }[];
  sources?: { fileName: string; content: string }[];
  figmaDiagram?: FigmaDiagram;
  generatedImage?: string;
  googleFormPreview?: GoogleFormPreview;
}

export interface Chat {
  id: string;
  stableKey: string; // Stable key for React that doesn't change when pending -> real ID
  title: string;
  timestamp: number;
  messages: Message[];
  archived?: boolean;
  hidden?: boolean;
}

const STORAGE_KEY = "sira-gpt-chats";
const PENDING_CHAT_PREFIX = "pending-";
const pendingToRealIdMap = new Map<string, string>();
const pendingMessageQueue = new Map<string, Message[]>();
const chatCreationInProgress = new Set<string>();

// Separate in-memory store for generated images (not persisted to localStorage)
const generatedImagesStore = new Map<string, string>();

export function storeGeneratedImage(messageId: string, imageData: string): void {
  generatedImagesStore.set(messageId, imageData);
}

export function getGeneratedImage(messageId: string): string | undefined {
  return generatedImagesStore.get(messageId);
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadChatsFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) throw new Error("Failed to load chats");
      const serverChats = await res.json();
      
      const formattedChats: Chat[] = await Promise.all(
        serverChats.map(async (chat: any) => {
          const chatRes = await fetch(`/api/chats/${chat.id}`);
          const fullChat = await chatRes.json();
          return {
            id: chat.id,
            stableKey: `stable-${chat.id}`, // Use ID as stable key for server chats
            title: chat.title,
            timestamp: new Date(chat.updatedAt).getTime(),
            archived: chat.archived === "true",
            hidden: chat.hidden === "true",
            messages: (fullChat.messages || []).map((msg: any) => ({
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: new Date(msg.createdAt),
              attachments: msg.attachments,
              sources: msg.sources,
              figmaDiagram: msg.figmaDiagram,
              googleFormPreview: msg.googleFormPreview,
              generatedImage: msg.generatedImage,
            })),
          };
        })
      );
      
      return formattedChats.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error("Error loading chats from server:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    const initChats = async () => {
      setIsLoading(true);
      
      const serverChats = await loadChatsFromServer();
      
      if (serverChats && serverChats.length > 0) {
        setChats(serverChats);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(serverChats));
        } catch (e) {
          console.warn("Failed to cache chats to localStorage:", e);
          localStorage.removeItem(STORAGE_KEY);
        }
        if (!activeChatId) {
          setActiveChatId(serverChats[0]?.id || null);
        }
      } else {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const restored = parsed.map((chat: any) => ({
              ...chat,
              stableKey: chat.stableKey || `stable-${chat.id}`, // Ensure stableKey exists
              messages: chat.messages.map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
              }))
            }));
            setChats(restored);
            if (!activeChatId && restored.length > 0) {
              setActiveChatId(restored[0]?.id || null);
            }
          } catch (e) {
            console.error("Failed to parse local chats", e);
          }
        }
      }
      
      setIsLoading(false);
    };
    
    initChats();
  }, []);

  useEffect(() => {
    if (!isLoading && chats.length > 0) {
      // Strip sources from messages to save localStorage space
      const chatsForStorage = chats.map(chat => ({
        ...chat,
        messages: chat.messages.map(msg => ({
          ...msg,
          sources: undefined, // Don't store sources in localStorage - they take too much space
          generatedImage: undefined // Don't store generated images in localStorage - they're too large
        }))
      }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chatsForStorage));
      } catch (e) {
        console.warn("Failed to save chats to localStorage:", e);
        // If storage is full, clear old data and try again
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [chats, isLoading]);

  const createChat = useCallback((): { pendingId: string; stableKey: string } => {
    const pendingId = `${PENDING_CHAT_PREFIX}${Date.now()}`;
    const stableKey = `stable-${Date.now()}`; // Stable key that won't change
    const pendingChat: Chat = {
      id: pendingId,
      stableKey,
      title: "Nuevo Chat",
      timestamp: Date.now(),
      messages: []
    };
    setChats(prev => [pendingChat, ...prev]);
    setActiveChatId(pendingId);
    return { pendingId, stableKey };
  }, []);

  const flushPendingMessages = async (pendingId: string, realChatId: string) => {
    while (pendingMessageQueue.has(pendingId) && pendingMessageQueue.get(pendingId)!.length > 0) {
      const queuedMessages = [...(pendingMessageQueue.get(pendingId) || [])];
      pendingMessageQueue.set(pendingId, []);
      
      for (const msg of queuedMessages) {
        try {
          await fetch(`/api/chats/${realChatId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: msg.role,
              content: msg.content,
              attachments: msg.attachments,
              sources: msg.sources,
              figmaDiagram: msg.figmaDiagram,
              googleFormPreview: msg.googleFormPreview,
              generatedImage: msg.generatedImage
            })
          });
        } catch (error) {
          console.error("Error flushing queued message:", error);
        }
      }
    }
    pendingMessageQueue.delete(pendingId);
  };

  const addMessage = useCallback(async (chatId: string, message: Message) => {
    const resolvedChatId = pendingToRealIdMap.get(chatId) || chatId;
    const isPending = resolvedChatId.startsWith(PENDING_CHAT_PREFIX);
    const isCreatingChat = chatCreationInProgress.has(chatId) || chatCreationInProgress.has(resolvedChatId);
    
    const title = message.role === "user" && message.content
      ? message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "")
      : "Nuevo Chat";

    setChats(prev => prev.map(chat => {
      const matchId = chat.id === chatId || chat.id === resolvedChatId;
      if (matchId) {
        const isFirstMessage = chat.messages.length === 0;
        return {
          ...chat,
          messages: [...chat.messages, message],
          title: isFirstMessage && message.role === "user" ? title : chat.title,
          timestamp: Date.now()
        };
      }
      return chat;
    }));

    if (isPending && message.role === "user" && !isCreatingChat) {
      chatCreationInProgress.add(chatId);
      const queue = pendingMessageQueue.get(chatId) || [];
      queue.push(message);
      pendingMessageQueue.set(chatId, queue);
      
      try {
        const res = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        });
        
        if (res.ok) {
          const newChat = await res.json();
          const realChatId = newChat.id;
          
          pendingToRealIdMap.set(chatId, realChatId);
          
          setChats(prev => prev.map(chat => {
            if (chat.id === chatId) {
              return { ...chat, id: realChatId };
            }
            return chat;
          }));
          setActiveChatId(realChatId);

          await flushPendingMessages(chatId, realChatId);
        } else {
          // If server creation fails (e.g., 401), keep using local-only chat
          // Clear the pending queue to prevent messages from being lost
          pendingMessageQueue.delete(chatId);
        }
      } catch (error) {
        console.error("Error creating chat on first message:", error);
        // Clear the pending queue on error to prevent messages from being lost
        pendingMessageQueue.delete(chatId);
      } finally {
        chatCreationInProgress.delete(chatId);
      }
    } else if (isPending || isCreatingChat) {
      const queueKey = chatCreationInProgress.has(chatId) ? chatId : resolvedChatId;
      const queue = pendingMessageQueue.get(queueKey) || [];
      queue.push(message);
      pendingMessageQueue.set(queueKey, queue);
    } else {
      try {
        await fetch(`/api/chats/${resolvedChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: message.role,
            content: message.content,
            attachments: message.attachments,
            sources: message.sources,
            figmaDiagram: message.figmaDiagram,
            googleFormPreview: message.googleFormPreview,
            generatedImage: message.generatedImage
          })
        });
      } catch (error) {
        console.error("Error saving message to server:", error);
      }
    }
  }, []);

  const deleteChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    setChats(prev => {
      const newChats = prev.filter(c => c.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(newChats[0]?.id || null);
      }
      return newChats;
    });

    try {
      await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    } catch (error) {
      console.error("Error deleting chat from server:", error);
    }
  }, [activeChatId]);

  const editChatTitle = useCallback(async (chatId: string, newTitle: string) => {
    setChats(prev => prev.map(chat => 
      chat.id === chatId ? { ...chat, title: newTitle } : chat
    ));

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle })
      });
    } catch (error) {
      console.error("Error updating chat title:", error);
    }
  }, []);

  const archiveChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    const chat = chats.find(c => c.id === chatId);
    const newArchived = !chat?.archived;
    
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, archived: newArchived } : c
    ));

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: newArchived })
      });
    } catch (error) {
      console.error("Error archiving chat:", error);
    }
  }, [chats]);

  const hideChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    const chat = chats.find(c => c.id === chatId);
    const newHidden = !chat?.hidden;
    
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, hidden: newHidden } : c
    ));

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: newHidden })
      });
    } catch (error) {
      console.error("Error hiding chat:", error);
    }
  }, [chats]);

  const activeChat = chats.find(c => c.id === activeChatId) || null;
  const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);
  const visibleChats = sortedChats.filter(c => !c.hidden);
  const archivedChats = sortedChats.filter(c => c.archived && !c.hidden);
  const hiddenChats = sortedChats.filter(c => c.hidden);

  const getChatDateLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    if (isThisWeek(date)) return "Previous 7 Days";
    if (isThisYear(date)) return format(date, "MMM d");
    return format(date, "yyyy");
  };

  return {
    chats: visibleChats,
    allChats: sortedChats,
    archivedChats,
    hiddenChats,
    activeChatId,
    activeChat,
    isLoading,
    setActiveChatId,
    createChat,
    addMessage,
    deleteChat,
    editChatTitle,
    archiveChat,
    hideChat,
    getChatDateLabel
  };
}
