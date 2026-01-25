import React, { createContext, useContext, useCallback, useState, useMemo, type ReactNode } from 'react';

/**
 * DialogContext - Centralized modal/dialog state management
 * Eliminates prop drilling for dialog open/close states across the app
 */

export type DialogType =
  | 'settings'
  | 'shortcuts'
  | 'export'
  | 'search'
  | 'gptExplorer'
  | 'gptBuilder'
  | 'library'
  | 'mediaLibrary'
  | 'apps'
  | 'favorites'
  | 'templates'
  | 'share'
  | 'upgrade'
  | 'documentGenerator'
  | 'googleForms'
  | 'pricing'
  | 'createProject'
  | 'editProject'
  | 'deleteConfirm';

export interface DialogState {
  isOpen: boolean;
  data?: any;
}

export interface DialogContextValue {
  // Check if a dialog is open
  isDialogOpen: (type: DialogType) => boolean;

  // Get dialog data
  getDialogData: <T = any>(type: DialogType) => T | undefined;

  // Open a dialog with optional data
  openDialog: (type: DialogType, data?: any) => void;

  // Close a specific dialog
  closeDialog: (type: DialogType) => void;

  // Close all dialogs
  closeAllDialogs: () => void;

  // Toggle a dialog
  toggleDialog: (type: DialogType, data?: any) => void;

  // Get all open dialogs
  openDialogs: DialogType[];
}

const DialogContext = createContext<DialogContextValue | null>(null);

export interface DialogProviderProps {
  children: ReactNode;
}

export function DialogProvider({ children }: DialogProviderProps) {
  const [dialogs, setDialogs] = useState<Map<DialogType, DialogState>>(new Map());

  const isDialogOpen = useCallback((type: DialogType): boolean => {
    return dialogs.get(type)?.isOpen ?? false;
  }, [dialogs]);

  const getDialogData = useCallback(<T = any>(type: DialogType): T | undefined => {
    return dialogs.get(type)?.data as T | undefined;
  }, [dialogs]);

  const openDialog = useCallback((type: DialogType, data?: any) => {
    setDialogs(prev => {
      const next = new Map(prev);
      next.set(type, { isOpen: true, data });
      return next;
    });
  }, []);

  const closeDialog = useCallback((type: DialogType) => {
    setDialogs(prev => {
      const next = new Map(prev);
      const current = next.get(type);
      if (current) {
        next.set(type, { ...current, isOpen: false });
      }
      return next;
    });
  }, []);

  const closeAllDialogs = useCallback(() => {
    setDialogs(prev => {
      const next = new Map(prev);
      for (const [key, value] of next) {
        next.set(key, { ...value, isOpen: false });
      }
      return next;
    });
  }, []);

  const toggleDialog = useCallback((type: DialogType, data?: any) => {
    setDialogs(prev => {
      const next = new Map(prev);
      const current = next.get(type);
      const isCurrentlyOpen = current?.isOpen ?? false;
      next.set(type, { isOpen: !isCurrentlyOpen, data: isCurrentlyOpen ? current?.data : data });
      return next;
    });
  }, []);

  const openDialogs = useMemo(() => {
    const open: DialogType[] = [];
    for (const [type, state] of dialogs) {
      if (state.isOpen) {
        open.push(type);
      }
    }
    return open;
  }, [dialogs]);

  const value = useMemo<DialogContextValue>(() => ({
    isDialogOpen,
    getDialogData,
    openDialog,
    closeDialog,
    closeAllDialogs,
    toggleDialog,
    openDialogs,
  }), [isDialogOpen, getDialogData, openDialog, closeDialog, closeAllDialogs, toggleDialog, openDialogs]);

  return (
    <DialogContext.Provider value={value}>
      {children}
    </DialogContext.Provider>
  );
}

/**
 * Hook to access dialog context
 * @throws Error if used outside of DialogProvider
 */
export function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error('useDialogContext must be used within a DialogProvider');
  }

  return context;
}

/**
 * Hook to manage a specific dialog
 */
export function useDialog(type: DialogType) {
  const { isDialogOpen, getDialogData, openDialog, closeDialog, toggleDialog } = useDialogContext();

  return useMemo(() => ({
    isOpen: isDialogOpen(type),
    data: getDialogData(type),
    open: (data?: any) => openDialog(type, data),
    close: () => closeDialog(type),
    toggle: (data?: any) => toggleDialog(type, data),
  }), [type, isDialogOpen, getDialogData, openDialog, closeDialog, toggleDialog]);
}

/**
 * Hook to check if any dialog is open (useful for preventing background interactions)
 */
export function useAnyDialogOpen(): boolean {
  const { openDialogs } = useDialogContext();
  return openDialogs.length > 0;
}

export default DialogContext;
