import { useState, useCallback, useRef } from 'react';
import { createPptStreamParser } from '@/lib/pptStreaming';

export function usePptStreaming() {
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const parserRef = useRef(createPptStreamParser());
  
  const startStreaming = useCallback(() => {
    parserRef.current.reset();
    isStreamingRef.current = true;
    setIsStreaming(true);
  }, []);
  
  const stopStreaming = useCallback(() => {
    parserRef.current.flush();
    isStreamingRef.current = false;
    setIsStreaming(false);
  }, []);
  
  const processChunk = useCallback((chunk: string) => {
    if (isStreamingRef.current) {
      parserRef.current.processChunk(chunk);
    }
  }, []);
  
  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    processChunk
  };
}
