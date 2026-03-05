/**
 * Hook: useRenderEngine
 * Manages render engine lifecycle and provides controls
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import type { RenderEngineType, RenderCategory } from '../types';
import { getRecommendedEngine, isEngineSupported } from '../utils/capabilities';
import { useRenderingCapabilities } from './useRenderingCapabilities';

interface UseRenderEngineOptions {
  engine?: RenderEngineType;
  category?: RenderCategory;
  fallback?: RenderEngineType;
}

interface UseRenderEngineReturn {
  activeEngine: RenderEngineType;
  isSupported: boolean;
  isLoading: boolean;
  error: string | null;
  engineRef: React.MutableRefObject<any>;
  setEngine: (engine: RenderEngineType) => void;
}

export function useRenderEngine(options: UseRenderEngineOptions = {}): UseRenderEngineReturn {
  const capabilities = useRenderingCapabilities();
  const engineRef = useRef<any>(null);

  const resolvedEngine = options.engine
    || (options.category ? getRecommendedEngine(options.category, capabilities) : 'rough');

  const [activeEngine, setActiveEngine] = useState<RenderEngineType>(resolvedEngine);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSupported = isEngineSupported(activeEngine, capabilities);

  useEffect(() => {
    if (!isSupported && options.fallback) {
      setActiveEngine(options.fallback);
    } else if (!isSupported) {
      setError(`Engine "${activeEngine}" is not supported on this device`);
    }
    setIsLoading(false);
  }, [activeEngine, isSupported, options.fallback]);

  const setEngine = useCallback((engine: RenderEngineType) => {
    setIsLoading(true);
    setError(null);
    setActiveEngine(engine);
  }, []);

  return {
    activeEngine,
    isSupported,
    isLoading,
    error,
    engineRef,
    setEngine,
  };
}
