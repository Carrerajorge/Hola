import { useState, useEffect } from "react";

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
  date: string; // specialized string for display like "Just now", "Yesterday"
  timestamp: number; // for sorting
  messages: Message[];
}

const STORAGE_KEY = "sira-gpt-chats";

const DEFAULT_CHATS: Chat[] = [
  { 
    id: "1", 
    title: "Welcome to Sira GPT", 
    date: "Just now", 
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
      date: "Just now",
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
          timestamp: Date.now(),
          date: "Just now" // Simplified for now
        };
      }
      return chat;
    }));
  };

  const activeChat = chats.find(c => c.id === activeChatId) || null;

  return {
    chats,
    activeChatId,
    activeChat,
    setActiveChatId,
    createChat,
    addMessage
  };
}
