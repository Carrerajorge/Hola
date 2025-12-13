import { useState, useEffect } from "react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  steps?: { title: string; status: "pending" | "loading" | "complete" }[];
  attachments?: { type: "word" | "excel" | "ppt"; name: string }[];
}

export interface Chat {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
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
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "New Chat",
      timestamp: Date.now(),
      messages: []
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
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

  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // Sort chats by timestamp descending
  const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);

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
    chats: sortedChats,
    activeChatId,
    activeChat,
    setActiveChatId,
    createChat,
    addMessage,
    deleteChat,
    getChatDateLabel
  };
}
