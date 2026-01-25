import { useState, useEffect, useRef, useCallback } from 'react';

export type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface UseLazyImageOptions {
  src: string;
  placeholder?: string;
  rootMargin?: string;
  threshold?: number;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

interface UseLazyImageResult {
  src: string;
  state: ImageLoadState;
  ref: (node: HTMLElement | null) => void;
  retry: () => void;
}

/**
 * Hook for lazy loading images with intersection observer
 * Only loads the image when it enters the viewport
 */
export function useLazyImage({
  src,
  placeholder = '',
  rootMargin = '200px',
  threshold = 0,
  onLoad,
  onError,
}: UseLazyImageOptions): UseLazyImageResult {
  const [state, setState] = useState<ImageLoadState>('idle');
  const [currentSrc, setCurrentSrc] = useState(placeholder);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  // Load the image
  const loadImage = useCallback(() => {
    if (!src) return;

    setState('loading');

    const img = new Image();

    img.onload = () => {
      setCurrentSrc(src);
      setState('loaded');
      retryCountRef.current = 0;
      onLoad?.();
    };

    img.onerror = () => {
      // Retry logic
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        setTimeout(loadImage, 1000 * retryCountRef.current);
        return;
      }

      setState('error');
      onError?.(new Error(`Failed to load image: ${src}`));
    };

    img.src = src;
  }, [src, onLoad, onError]);

  // Retry loading
  const retry = useCallback(() => {
    retryCountRef.current = 0;
    setState('idle');
    if (isIntersecting) {
      loadImage();
    }
  }, [isIntersecting, loadImage]);

  // Set up intersection observer
  const setRef = useCallback((node: HTMLElement | null) => {
    // Clean up old observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (!node) {
      elementRef.current = null;
      return;
    }

    elementRef.current = node;

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsIntersecting(true);
        }
      },
      {
        rootMargin,
        threshold,
      }
    );

    observerRef.current.observe(node);
  }, [rootMargin, threshold]);

  // Load image when it becomes visible
  useEffect(() => {
    if (isIntersecting && state === 'idle') {
      loadImage();
    }
  }, [isIntersecting, state, loadImage]);

  // Clean up observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    src: currentSrc,
    state,
    ref: setRef,
    retry,
  };
}

/**
 * Hook for preloading multiple images
 */
export function useImagePreloader(urls: string[]) {
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadImage = (url: string) => {
      const img = new Image();
      img.onload = () => {
        setLoaded(prev => new Set(prev).add(url));
      };
      img.onerror = () => {
        setFailed(prev => new Set(prev).add(url));
      };
      img.src = url;
    };

    urls.forEach(loadImage);
  }, [urls]);

  return {
    loaded,
    failed,
    isAllLoaded: loaded.size === urls.length,
    progress: urls.length > 0 ? loaded.size / urls.length : 0,
  };
}

/**
 * Hook for responsive image loading
 * Loads different image sizes based on viewport
 */
export function useResponsiveImage(sources: {
  mobile: string;
  tablet: string;
  desktop: string;
}) {
  const [currentSrc, setCurrentSrc] = useState(sources.mobile);

  useEffect(() => {
    const updateSrc = () => {
      const width = window.innerWidth;
      if (width >= 1024) {
        setCurrentSrc(sources.desktop);
      } else if (width >= 768) {
        setCurrentSrc(sources.tablet);
      } else {
        setCurrentSrc(sources.mobile);
      }
    };

    updateSrc();
    window.addEventListener('resize', updateSrc);

    return () => {
      window.removeEventListener('resize', updateSrc);
    };
  }, [sources]);

  return currentSrc;
}

/**
 * Hook for progressive image loading
 * Shows a low-quality placeholder first, then loads the full image
 */
export function useProgressiveImage(
  lowQualitySrc: string,
  highQualitySrc: string
): { src: string; isLoading: boolean } {
  const [src, setSrc] = useState(lowQualitySrc);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSrc(lowQualitySrc);
    setIsLoading(true);

    const img = new Image();
    img.onload = () => {
      setSrc(highQualitySrc);
      setIsLoading(false);
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = highQualitySrc;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [lowQualitySrc, highQualitySrc]);

  return { src, isLoading };
}

export default useLazyImage;
