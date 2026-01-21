/**
 * Streaming Indicator Component
 * Shows AI thinking/responding state
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, X, Brain, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StreamingIndicatorProps } from './types';

export function StreamingIndicator({
    aiState,
    streamingContent,
    onCancel,
    uiPhase
}: StreamingIndicatorProps) {
    if (aiState === 'idle') return null;

    const isThinking = aiState === 'thinking' || uiPhase === 'thinking';
    const isResponding = aiState === 'responding';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg border"
        >
            {/* Status Icon */}
            <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full",
                isThinking ? "bg-blue-500/20" : "bg-green-500/20"
            )}>
                {isThinking ? (
                    <Brain className="w-4 h-4 text-blue-500 animate-pulse" />
                ) : (
                    <Sparkles className="w-4 h-4 text-green-500" />
                )}
            </div>

            {/* Status Text */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                    {isThinking ? 'Pensando...' : 'Respondiendo...'}
                </p>
                {isResponding && streamingContent && (
                    <p className="text-xs text-muted-foreground truncate">
                        {streamingContent.length} caracteres generados
                    </p>
                )}
            </div>

            {/* Loading Animation */}
            <div className="flex items-center gap-1">
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
                <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                    className="w-2 h-2 bg-primary rounded-full"
                />
            </div>

            {/* Cancel Button */}
            <Button
                variant="ghost"
                size="icon"
                onClick={onCancel}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
                <X className="w-4 h-4" />
            </Button>
        </motion.div>
    );
}
