/**
 * Hook: useRenderingCapabilities
 * Detects and caches browser rendering capabilities
 */

import { useState, useEffect } from 'react';
import type { RenderingCapabilities } from '../types';
import { detectRenderingCapabilities } from '../utils/capabilities';

export function useRenderingCapabilities(): RenderingCapabilities {
  const [capabilities, setCapabilities] = useState<RenderingCapabilities>(() =>
    detectRenderingCapabilities()
  );

  useEffect(() => {
    // Re-detect on mount in case SSR gave wrong values
    setCapabilities(detectRenderingCapabilities());
  }, []);

  return capabilities;
}
