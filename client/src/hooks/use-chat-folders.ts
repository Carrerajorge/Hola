import { useState, useEffect, useCallback } from "react";

export interface Folder {
  id: string;
  name: string;
  color: string;
  chatIds: string[];
}

const STORAGE_KEY = "sira-gpt-folders";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeFolder(raw: unknown): Folder | null {
  if (!isRecord(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const color = typeof raw.color === "string" && raw.color.trim().length > 0 ? raw.color : FOLDER_COLORS[0].value;
  const chatIds = Array.isArray(raw.chatIds)
    ? raw.chatIds.filter((chatId): chatId is string => typeof chatId === "string" && chatId.trim().length > 0)
    : [];

  if (!id || !name) return null;

  return {
    id,
    name,
    color,
    chatIds,
  };
}

export const FOLDER_COLORS = [
  { name: "blue", value: "#3b82f6" },
  { name: "green", value: "#22c55e" },
  { name: "purple", value: "#a855f7" },
  { name: "orange", value: "#f97316" },
  { name: "red", value: "#ef4444" },
  { name: "pink", value: "#ec4899" },
];

export function useChatFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const parsedFolders = Array.isArray(parsed)
          ? parsed.map(normalizeFolder).filter((folder): folder is Folder => folder !== null)
          : [];
        // Filter out test folder "luis0"
        const filteredFolders = parsedFolders.filter(f => f.name !== "luis0");
        setFolders(filteredFolders);
        // If we filtered something, save the cleaned data back
        if (!Array.isArray(parsed) || filteredFolders.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredFolders));
        }
      } catch (e) {
        console.error("Failed to parse folders", e);
      }
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
    } catch (error) {
      console.error("Failed to save folders", error);
    }
  }, [folders]);

  const createFolder = useCallback((name: string, color?: string) => {
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name,
      color: color || FOLDER_COLORS[folders.length % FOLDER_COLORS.length].value,
      chatIds: [],
    };
    setFolders((prev) => [...prev, newFolder]);
    return newFolder;
  }, [folders.length]);

  const renameFolder = useCallback((folderId: string, newName: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f))
    );
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
  }, []);

  const moveChatToFolder = useCallback((chatId: string, folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) {
          if (!f.chatIds.includes(chatId)) {
            return { ...f, chatIds: [...f.chatIds, chatId] };
          }
          return f;
        }
        return { ...f, chatIds: f.chatIds.filter((id) => id !== chatId) };
      })
    );
  }, []);

  const removeChatFromFolder = useCallback((chatId: string) => {
    setFolders((prev) =>
      prev.map((f) => ({
        ...f,
        chatIds: f.chatIds.filter((id) => id !== chatId),
      }))
    );
  }, []);

  const getFolderForChat = useCallback(
    (chatId: string): Folder | null => {
      return folders.find((f) => f.chatIds.includes(chatId)) || null;
    },
    [folders]
  );

  return {
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveChatToFolder,
    removeChatFromFolder,
    getFolderForChat,
  };
}
