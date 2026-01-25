import React, { createContext, useContext, useCallback, useState, useMemo, type ReactNode } from 'react';
import type { Chat } from '@/hooks/use-chats';
import type { Folder } from '@/hooks/use-chat-folders';

/**
 * SidebarContext - Eliminates prop drilling for sidebar-related callbacks
 * Provides centralized state management for chat operations
 */

export interface SidebarContextValue {
  // Chat selection
  activeChatId: string | null;
  selectChat: (id: string) => void;

  // Chat CRUD operations
  createNewChat: () => void;
  deleteChat: (id: string, e?: React.MouseEvent) => void;
  editChat: (id: string, newTitle: string) => void;
  archiveChat: (id: string, e?: React.MouseEvent) => void;
  hideChat: (id: string, e?: React.MouseEvent) => void;
  pinChat: (id: string, e?: React.MouseEvent) => void;
  downloadChat: (id: string, e?: React.MouseEvent) => void;

  // Folder operations
  createFolder: (name: string) => void;
  moveToFolder: (chatId: string, folderId: string | null) => void;
  folders: Folder[];

  // Dialog toggles
  openGpts: () => void;
  openApps: () => void;
  openSkills: () => void;
  openLibrary: () => void;

  // Processing state
  processingChatIds: string[];
  pendingResponseCounts: Record<string, number>;
  clearPendingCount: (chatId: string) => void;

  // Project selection
  selectedProjectId: string | null;
  selectProject: (projectId: string) => void;

  // Sidebar state
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export interface SidebarProviderProps {
  children: ReactNode;
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat?: () => void;
  onDeleteChat?: (id: string, e?: React.MouseEvent) => void;
  onEditChat?: (id: string, newTitle: string) => void;
  onArchiveChat?: (id: string, e?: React.MouseEvent) => void;
  onHideChat?: (id: string, e?: React.MouseEvent) => void;
  onPinChat?: (id: string, e?: React.MouseEvent) => void;
  onDownloadChat?: (id: string, e?: React.MouseEvent) => void;
  onOpenGpts?: () => void;
  onOpenApps?: () => void;
  onOpenSkills?: () => void;
  onOpenLibrary?: () => void;
  processingChatIds?: string[];
  pendingResponseCounts?: Record<string, number>;
  onClearPendingCount?: (chatId: string) => void;
  folders?: Folder[];
  onCreateFolder?: (name: string) => void;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function SidebarProvider({
  children,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onEditChat,
  onArchiveChat,
  onHideChat,
  onPinChat,
  onDownloadChat,
  onOpenGpts,
  onOpenApps,
  onOpenSkills,
  onOpenLibrary,
  processingChatIds = [],
  pendingResponseCounts = {},
  onClearPendingCount,
  folders = [],
  onCreateFolder,
  onMoveToFolder,
  selectedProjectId = null,
  onSelectProject,
  isCollapsed = false,
  onToggle,
}: SidebarProviderProps) {
  // Memoized callbacks to prevent unnecessary re-renders
  const selectChat = useCallback((id: string) => {
    onSelectChat(id);
  }, [onSelectChat]);

  const createNewChat = useCallback(() => {
    onNewChat?.();
  }, [onNewChat]);

  const deleteChat = useCallback((id: string, e?: React.MouseEvent) => {
    onDeleteChat?.(id, e);
  }, [onDeleteChat]);

  const editChat = useCallback((id: string, newTitle: string) => {
    onEditChat?.(id, newTitle);
  }, [onEditChat]);

  const archiveChat = useCallback((id: string, e?: React.MouseEvent) => {
    onArchiveChat?.(id, e);
  }, [onArchiveChat]);

  const hideChat = useCallback((id: string, e?: React.MouseEvent) => {
    onHideChat?.(id, e);
  }, [onHideChat]);

  const pinChat = useCallback((id: string, e?: React.MouseEvent) => {
    onPinChat?.(id, e);
  }, [onPinChat]);

  const downloadChat = useCallback((id: string, e?: React.MouseEvent) => {
    onDownloadChat?.(id, e);
  }, [onDownloadChat]);

  const createFolder = useCallback((name: string) => {
    onCreateFolder?.(name);
  }, [onCreateFolder]);

  const moveToFolder = useCallback((chatId: string, folderId: string | null) => {
    onMoveToFolder?.(chatId, folderId);
  }, [onMoveToFolder]);

  const openGpts = useCallback(() => {
    onOpenGpts?.();
  }, [onOpenGpts]);

  const openApps = useCallback(() => {
    onOpenApps?.();
  }, [onOpenApps]);

  const openSkills = useCallback(() => {
    onOpenSkills?.();
  }, [onOpenSkills]);

  const openLibrary = useCallback(() => {
    onOpenLibrary?.();
  }, [onOpenLibrary]);

  const clearPendingCount = useCallback((chatId: string) => {
    onClearPendingCount?.(chatId);
  }, [onClearPendingCount]);

  const selectProject = useCallback((projectId: string) => {
    onSelectProject?.(projectId);
  }, [onSelectProject]);

  const toggleSidebar = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  const value = useMemo<SidebarContextValue>(() => ({
    activeChatId,
    selectChat,
    createNewChat,
    deleteChat,
    editChat,
    archiveChat,
    hideChat,
    pinChat,
    downloadChat,
    createFolder,
    moveToFolder,
    folders,
    openGpts,
    openApps,
    openSkills,
    openLibrary,
    processingChatIds,
    pendingResponseCounts,
    clearPendingCount,
    selectedProjectId,
    selectProject,
    isCollapsed,
    toggleSidebar,
  }), [
    activeChatId,
    selectChat,
    createNewChat,
    deleteChat,
    editChat,
    archiveChat,
    hideChat,
    pinChat,
    downloadChat,
    createFolder,
    moveToFolder,
    folders,
    openGpts,
    openApps,
    openSkills,
    openLibrary,
    processingChatIds,
    pendingResponseCounts,
    clearPendingCount,
    selectedProjectId,
    selectProject,
    isCollapsed,
    toggleSidebar,
  ]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * Hook to access sidebar context
 * @throws Error if used outside of SidebarProvider
 */
export function useSidebarContext(): SidebarContextValue {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }

  return context;
}

/**
 * Hook to access sidebar context safely (returns null if not in provider)
 */
export function useSidebarContextSafe(): SidebarContextValue | null {
  return useContext(SidebarContext);
}

export default SidebarContext;
