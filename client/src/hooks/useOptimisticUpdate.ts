import { useState, useCallback, useRef } from 'react';

/**
 * Hook for optimistic UI updates
 * Immediately shows the updated state while the actual update happens in the background
 */
export function useOptimisticUpdate<T>(initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const rollbackValueRef = useRef<T>(initialValue);

  /**
   * Perform an optimistic update
   * @param optimisticValue - The value to show immediately
   * @param updateFn - The async function that performs the actual update
   */
  const update = useCallback(async (
    optimisticValue: T,
    updateFn: () => Promise<T | void>
  ): Promise<boolean> => {
    // Store current value for potential rollback
    rollbackValueRef.current = value;

    // Apply optimistic update immediately
    setValue(optimisticValue);
    setIsUpdating(true);
    setError(null);

    try {
      const result = await updateFn();

      // If the update returns a value, use it (server might modify the data)
      if (result !== undefined) {
        setValue(result);
      }

      setIsUpdating(false);
      return true;
    } catch (err) {
      // Rollback to previous value on error
      setValue(rollbackValueRef.current);
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsUpdating(false);
      return false;
    }
  }, [value]);

  /**
   * Manually rollback to the previous value
   */
  const rollback = useCallback(() => {
    setValue(rollbackValueRef.current);
    setError(null);
  }, []);

  /**
   * Reset error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    value,
    setValue,
    isUpdating,
    error,
    update,
    rollback,
    clearError,
  };
}

/**
 * Hook for optimistic list updates (add, remove, update items)
 */
export function useOptimisticList<T extends { id: string | number }>(
  initialItems: T[]
) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [pendingIds, setPendingIds] = useState<Set<string | number>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const rollbackItemsRef = useRef<T[]>(initialItems);

  /**
   * Optimistically add an item
   */
  const addItem = useCallback(async (
    newItem: T,
    addFn: () => Promise<T | void>
  ): Promise<boolean> => {
    rollbackItemsRef.current = items;
    setItems(prev => [...prev, newItem]);
    setPendingIds(prev => new Set(prev).add(newItem.id));
    setError(null);

    try {
      const result = await addFn();
      if (result) {
        // Replace temp item with server response
        setItems(prev => prev.map(item =>
          item.id === newItem.id ? result : item
        ));
      }
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(newItem.id);
        return next;
      });
      return true;
    } catch (err) {
      setItems(rollbackItemsRef.current);
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(newItem.id);
        return next;
      });
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, [items]);

  /**
   * Optimistically remove an item
   */
  const removeItem = useCallback(async (
    itemId: string | number,
    removeFn: () => Promise<void>
  ): Promise<boolean> => {
    rollbackItemsRef.current = items;
    setItems(prev => prev.filter(item => item.id !== itemId));
    setPendingIds(prev => new Set(prev).add(itemId));
    setError(null);

    try {
      await removeFn();
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      return true;
    } catch (err) {
      setItems(rollbackItemsRef.current);
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, [items]);

  /**
   * Optimistically update an item
   */
  const updateItem = useCallback(async (
    itemId: string | number,
    updates: Partial<T>,
    updateFn: () => Promise<T | void>
  ): Promise<boolean> => {
    rollbackItemsRef.current = items;
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, ...updates } : item
    ));
    setPendingIds(prev => new Set(prev).add(itemId));
    setError(null);

    try {
      const result = await updateFn();
      if (result) {
        setItems(prev => prev.map(item =>
          item.id === itemId ? result : item
        ));
      }
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      return true;
    } catch (err) {
      setItems(rollbackItemsRef.current);
      setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }, [items]);

  /**
   * Check if an item has a pending operation
   */
  const isPending = useCallback((itemId: string | number) => {
    return pendingIds.has(itemId);
  }, [pendingIds]);

  /**
   * Rollback to previous state
   */
  const rollback = useCallback(() => {
    setItems(rollbackItemsRef.current);
    setPendingIds(new Set());
    setError(null);
  }, []);

  return {
    items,
    setItems,
    addItem,
    removeItem,
    updateItem,
    isPending,
    pendingIds,
    error,
    rollback,
    clearError: useCallback(() => setError(null), []),
  };
}

export default useOptimisticUpdate;
