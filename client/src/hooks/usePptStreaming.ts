import { useState, useCallback, useRef } from 'react';
import { createPptStreamParser } from '@/lib/pptStreaming';

export function usePptStreaming() {
  const [isStreaming, setIsStreaming] = useState(false);
  const parserRef = useRef(createPptStreamParser());
  
  const startStreaming = useCallback(() => {
    parserRef.current.reset();
    setIsStreaming(true);
  }, []);
  
  const stopStreaming = useCallback(() => {
    parserRef.current.flush();
    setIsStreaming(false);
  }, []);
  
  const processChunk = useCallback((chunk: string) => {
    if (isStreaming) {
      parserRef.current.processChunk(chunk);
    }
  }, [isStreaming]);
  
  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    processChunk
  };
}
