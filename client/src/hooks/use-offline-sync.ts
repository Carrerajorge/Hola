import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnlineStatus } from './use-online-status';
import { offlineQueue, PendingMessage } from '../lib/offlineQueue';
import { nanoid } from 'nanoid';

interface UseOfflineSyncOptions {
  onSyncStart?: () => void;
  onSyncComplete?: (syncedCount: number) => void;
  onSyncError?: (error: Error) => void;
  sendMessage: (chatId: string, content: string) => Promise<boolean>;
}

export function useOfflineSync(options: UseOfflineSyncOptions) {
  const { sendMessage, onSyncStart, onSyncComplete, onSyncError } = options;
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);

  const updatePendingCount = useCallback(async () => {
    try {
      const count = await offlineQueue.getMessageCount();
      setPendingCount(count);
    } catch (error) {
      console.error('Error getting pending count:', error);
    }
  }, []);

  const queueMessage = useCallback(async (chatId: string, content: string): Promise<string> => {
    const id = nanoid();
    await offlineQueue.addMessage({
      id,
      chatId,
      content,
      timestamp: Date.now(),
    });
    await updatePendingCount();
    return id;
  }, [updatePendingCount]);

  const syncPendingMessages = useCallback(async () => {
    if (syncInProgress.current || !isOnline) return;
    
    syncInProgress.current = true;
    setIsSyncing(true);
    onSyncStart?.();

    try {
      const pending = await offlineQueue.getPendingMessages();
      let syncedCount = 0;

      for (const message of pending) {
        if (!navigator.onLine) break;

        try {
          await offlineQueue.updateMessageStatus(message.id, 'syncing');
          const success = await sendMessage(message.chatId, message.content);
          
          if (success) {
            await offlineQueue.removeMessage(message.id);
            syncedCount++;
          } else {
            await offlineQueue.updateMessageStatus(message.id, 'failed');
          }
        } catch (error) {
          console.error('Error syncing message:', error);
          await offlineQueue.updateMessageStatus(message.id, 'failed');
        }
      }

      await updatePendingCount();
      onSyncComplete?.(syncedCount);
    } catch (error) {
      console.error('Sync error:', error);
      onSyncError?.(error as Error);
    } finally {
      setIsSyncing(false);
      syncInProgress.current = false;
    }
  }, [isOnline, sendMessage, onSyncStart, onSyncComplete, onSyncError, updatePendingCount]);

  useEffect(() => {
    if (wasOffline && isOnline) {
      syncPendingMessages();
      resetWasOffline();
    }
  }, [wasOffline, isOnline, syncPendingMessages, resetWasOffline]);

  useEffect(() => {
    updatePendingCount();
  }, [updatePendingCount]);

  const sendOrQueue = useCallback(async (chatId: string, content: string): Promise<{ queued: boolean; id?: string }> => {
    if (!isOnline) {
      const id = await queueMessage(chatId, content);
      return { queued: true, id };
    }

    try {
      const success = await sendMessage(chatId, content);
      if (!success) {
        const id = await queueMessage(chatId, content);
        return { queued: true, id };
      }
      return { queued: false };
    } catch (error) {
      const id = await queueMessage(chatId, content);
      return { queued: true, id };
    }
  }, [isOnline, sendMessage, queueMessage]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    queueMessage,
    sendOrQueue,
    syncPendingMessages,
    updatePendingCount,
  };
}
