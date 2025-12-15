import { useState, useEffect, useCallback } from "react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  steps?: { title: string; status: "pending" | "loading" | "complete" }[];
  attachments?: { type: "word" | "excel" | "ppt" | "image"; name: string; imageUrl?: string; storagePath?: string; fileId?: string }[];
  sources?: { fileName: string; content: string }[];
}

export interface Chat {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
  archived?: boolean;
  hidden?: boolean;
}

const STORAGE_KEY = "sira-gpt-chats";

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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serverChats));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    }
  }, [chats, isLoading]);

  const createChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" })
      });
      
      if (!res.ok) throw new Error("Failed to create chat");
      const newChat = await res.json();
      
      const chat: Chat = {
        id: newChat.id,
        title: newChat.title,
        timestamp: new Date(newChat.createdAt).getTime(),
        messages: []
      };
      
      setChats(prev => [chat, ...prev]);
      setActiveChatId(chat.id);
      return true;
    } catch (error) {
      console.error("Error creating chat:", error);
      const newChat: Chat = {
        id: Date.now().toString(),
        title: "New Chat",
        timestamp: Date.now(),
        messages: []
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      return true;
    }
  }, [chats, activeChatId]);

  const addMessage = useCallback(async (chatId: string, message: Message) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        const updatedMessages = [...chat.messages, message];
        let title = chat.title;
        if (chat.messages.length === 0 && message.role === "user") {
          title = message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "");
        }
        
        return {
          ...chat,
          messages: updatedMessages,
          title: title,
          timestamp: Date.now()
        };
      }
      return chat;
    }));

    try {
      await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: message.role,
          content: message.content,
          attachments: message.attachments,
          sources: message.sources
        })
      });
    } catch (error) {
      console.error("Error saving message to server:", error);
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
