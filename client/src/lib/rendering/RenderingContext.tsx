/**
 * Rendering Context
 * Provides rendering capabilities and engine management to the component tree
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { RenderingContextValue, RenderEngineType, RenderCategory } from './types';
import { useRenderingCapabilities } from './hooks/useRenderingCapabilities';
import { getRecommendedEngine } from './utils/capabilities';

const RenderingContext = createContext<RenderingContextValue | null>(null);

export function RenderingProvider({ children }: { children: React.ReactNode }) {
  const capabilities = useRenderingCapabilities();
  const [activeEngines, setActiveEngines] = useState<Set<RenderEngineType>>(new Set());

  const registerEngine = useCallback((type: RenderEngineType) => {
    setActiveEngines((prev) => new Set(prev).add(type));
  }, []);

  const unregisterEngine = useCallback((type: RenderEngineType) => {
    setActiveEngines((prev) => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
  }, []);

  const getRecommended = useCallback(
    (category: RenderCategory) => getRecommendedEngine(category, capabilities),
    [capabilities]
  );

  const value = useMemo<RenderingContextValue>(
    () => ({
      capabilities,
      activeEngines,
      registerEngine,
      unregisterEngine,
      getRecommendedEngine: getRecommended,
    }),
    [capabilities, activeEngines, registerEngine, unregisterEngine, getRecommended]
  );

  return (
    <RenderingContext.Provider value={value}>
      {children}
    </RenderingContext.Provider>
  );
}

export function useRenderingContext(): RenderingContextValue {
  const context = useContext(RenderingContext);
  if (!context) {
    throw new Error('useRenderingContext must be used within a RenderingProvider');
  }
  return context;
}

export { RenderingContext };
