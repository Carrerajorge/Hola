import { useState, useEffect } from "react";
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

const DEFAULT_CHATS: Chat[] = [
  { 
    id: "1", 
    title: "Welcome to Sira GPT", 
    timestamp: Date.now(),
    messages: [
      {
        id: "welcome-1",
        role: "assistant",
        content: "Hello! I'm Sira GPT. How can I help you today?",
        timestamp: new Date()
      }
    ]
  }
];

export function useChats() {
  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Restore Date objects for messages
        return parsed.map((chat: any) => ({
          ...chat,
          messages: chat.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }))
        }));
      } catch (e) {
        console.error("Failed to parse chats", e);
        return DEFAULT_CHATS;
      }
    }
    return DEFAULT_CHATS;
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(chats[0]?.id || null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  }, [chats]);

  const createChat = () => {
    const currentActiveChat = chats.find(c => c.id === activeChatId);
    const hasUserMessages = currentActiveChat?.messages.some(msg => msg.role === "user");
    if (currentActiveChat && !hasUserMessages) {
      return false;
    }
    
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "New Chat",
      timestamp: Date.now(),
      messages: []
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    return true;
  };

  const addMessage = (chatId: string, message: Message) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        const updatedMessages = [...chat.messages, message];
        // Update title based on first user message if it's "New Chat"
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
  };

  const deleteChat = (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChats(prev => {
      const newChats = prev.filter(c => c.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(newChats[0]?.id || null);
      }
      return newChats;
    });
  };

  const editChatTitle = (chatId: string, newTitle: string) => {
    setChats(prev => prev.map(chat => 
      chat.id === chatId ? { ...chat, title: newTitle } : chat
    ));
  };

  const archiveChat = (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChats(prev => prev.map(chat => 
      chat.id === chatId ? { ...chat, archived: !chat.archived } : chat
    ));
  };

  const hideChat = (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChats(prev => prev.map(chat => 
      chat.id === chatId ? { ...chat, hidden: !chat.hidden } : chat
    ));
  };

  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // Sort chats by timestamp descending
  const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);
  
  // Filter visible chats (not hidden)
  const visibleChats = sortedChats.filter(c => !c.hidden);
  
  // Get archived chats
  const archivedChats = sortedChats.filter(c => c.archived && !c.hidden);
  
  // Get hidden chats
  const hiddenChats = sortedChats.filter(c => c.hidden);

  // Helper to format date label
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
