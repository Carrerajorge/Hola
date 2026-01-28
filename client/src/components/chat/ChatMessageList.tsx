
import React, { useRef, useMemo, useEffect } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { motion } from "framer-motion";
import { Message } from "@/hooks/use-chats";
import { MessageItem } from "./MessageItem";
import { SuggestedReplies, generateSuggestions } from "@/components/suggested-replies";
import { PhaseNarrator } from "@/components/thinking-indicator";
import { LiveExecutionConsole } from "@/components/live-execution-console";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { CleanDataTableComponents, DocumentBlock, parseDocumentBlocks } from "./MessageParts";
import { detectClientIntent } from "@/lib/clientIntentDetector";
import { messageLogger } from "@/lib/logger";
import { AgentArtifact } from "@/components/agent-steps-display";

export interface ChatMessageListProps {
    messages: Message[];
    variant: "compact" | "default";
    editingMessageId: string | null;
    editContent: string;
    setEditContent: (value: string) => void;
    copiedMessageId: string | null;
    messageFeedback: Record<string, "up" | "down" | null>;
    speakingMessageId: string | null;
    isGeneratingImage: boolean;
    pendingGeneratedImage: { messageId: string; imageData: string } | null;
    latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
    streamingContent: string;
    aiState: "idle" | "thinking" | "responding" | "agent_working";
    regeneratingMsgIndex: number | null;
    handleCopyMessage: (content: string, id: string) => void;
    handleStartEdit: (msg: Message) => void;
    handleCancelEdit: () => void;
    handleSendEdit: (id: string) => void;
    handleFeedback: (id: string, type: "up" | "down") => void;
    handleRegenerate: (index: number) => void;
    handleShare: (content: string) => void;
    handleReadAloud: (id: string, content: string) => void;
    handleOpenDocumentPreview: (doc: DocumentBlock) => void;
    handleOpenFileAttachmentPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
    handleDownloadImage: (imageData: string) => void;
    setLightboxImage: (imageData: string | null) => void;
    handleReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
    minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
    onRestoreDocument?: () => void;
    onSelectSuggestedReply?: (text: string) => void;
    parentRef?: React.RefObject<HTMLDivElement>;
    onAgentCancel?: (messageId: string, runId: string) => void;
    onAgentRetry?: (messageId: string, userMessage: string) => void;
    onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
    onSuperAgentCancel?: (messageId: string) => void;
    onSuperAgentRetry?: (messageId: string) => void;
    onQuestionClick?: (question: string) => void;
    activeRunId?: string | null;
    onRunComplete?: (artifacts: Array<{ id: string; type: string; name: string; url: string }>) => void;
    uiPhase?: 'idle' | 'thinking' | 'console' | 'done';
    aiProcessSteps?: { step: string; status: "pending" | "active" | "done" }[];
}

export function ChatMessageList({
    messages,
    variant,
    editingMessageId,
    editContent,
    setEditContent,
    copiedMessageId,
    messageFeedback,
    speakingMessageId,
    isGeneratingImage,
    pendingGeneratedImage,
    latestGeneratedImageRef,
    streamingContent,
    aiState,
    regeneratingMsgIndex,
    handleCopyMessage,
    handleStartEdit,
    handleCancelEdit,
    handleSendEdit,
    handleFeedback,
    handleRegenerate,
    handleShare,
    handleReadAloud,
    handleOpenDocumentPreview,
    handleOpenFileAttachmentPreview,
    handleDownloadImage,
    setLightboxImage,
    handleReopenDocument,
    minimizedDocument,
    onRestoreDocument,
    onSelectSuggestedReply,
    parentRef, // Note: Virtuoso handles its own scrolling container usually, but we can pass ref if needed or use Virtuoso reference
    onAgentCancel,
    onAgentRetry,
    onAgentArtifactPreview,
    onSuperAgentCancel,
    onSuperAgentRetry,
    onQuestionClick,
    activeRunId,
    onRunComplete,
    uiPhase = 'idle',
    aiProcessSteps = []
}: ChatMessageListProps) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Debug logging
    useEffect(() => {
        messageLogger.debug('ChatMessageList render', {
            msgCount: messages.length,
            aiState,
            variant,
            streaming: !!streamingContent
        });
    }, [messages.length, aiState, variant, streamingContent]);

    const lastAssistantMessage = useMemo(() => {
        return messages.filter(m => m.role === "assistant").pop();
    }, [messages]);

    const detectedIntent = useMemo(() => {
        const lastUserMsg = messages.filter(m => m.role === "user").pop();
        return lastUserMsg ? detectClientIntent(lastUserMsg.content) : undefined;
    }, [messages]);

    const realTimePhase = useMemo(() => {
        if (!aiProcessSteps.length) return undefined;
        const activeStep = aiProcessSteps.find(s => s.status === 'active') || aiProcessSteps[aiProcessSteps.length - 1];
        if (!activeStep) return undefined;

        const stepText = activeStep.step.toLowerCase();
        if (stepText.includes('connect') || stepText.includes('start')) return 'connecting';
        if (stepText.includes('search') || stepText.includes('query')) return 'searching';
        if (stepText.includes('analyz') || stepText.includes('read') || stepText.includes('review')) return 'analyzing';
        if (stepText.includes('process') || stepText.includes('comput') || stepText.includes('calculat')) return 'processing';
        if (stepText.includes('generat') || stepText.includes('writ') || stepText.includes('creat')) return 'generating';
        if (stepText.includes('respond') || stepText.includes('reply')) return 'responding';
        if (stepText.includes('final') || stepText.includes('don') || stepText.includes('complet')) return 'finalizing';

        return 'processing';
    }, [aiProcessSteps]);

    const isLastMessageAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
    const showSuggestedReplies = variant === "default" && aiState === "idle" && isLastMessageAssistant && lastAssistantMessage && !streamingContent;

    const suggestions = useMemo(() => {
        return showSuggestedReplies && lastAssistantMessage ? generateSuggestions(lastAssistantMessage.content) : [];
    }, [showSuggestedReplies, lastAssistantMessage?.content]);

    // Footer component for Virtuoso
    const ListFooter = useMemo(() => {
        return () => (
            <>
                {streamingContent && variant === "default" && (
                    <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start pb-4">
                        <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
                            <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
                                <MarkdownErrorBoundary key={`stream-virt-${streamingContent.length}`} fallbackContent={streamingContent}>
                                    <MarkdownRenderer
                                        content={streamingContent}
                                        customComponents={{ ...CleanDataTableComponents }}
                                    />
                                </MarkdownErrorBoundary>
                                <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
                            </div>
                        </div>
                    </div>
                )}

                {showSuggestedReplies && suggestions.length > 0 && onSelectSuggestedReply && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start mt-2 pb-4"
                    >
                        <SuggestedReplies
                            suggestions={suggestions}
                            onSelect={onSelectSuggestedReply}
                        />
                    </motion.div>
                )}

                {uiPhase === 'console' && activeRunId && variant === "default" && (
                    <motion.div
                        key={`execution-console-virt-${activeRunId}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start pb-4"
                    >
                        <LiveExecutionConsole
                            key={`virt-${activeRunId}`}
                            runId={activeRunId}
                            onComplete={onRunComplete}
                            className="flex-1"
                        />
                    </motion.div>
                )}

                {aiState !== "idle" && !streamingContent && variant === "default" && uiPhase !== 'console' && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        data-testid="thinking-indicator-virt"
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start px-4 pb-4"
                    >
                        <PhaseNarrator
                            autoProgress={!realTimePhase}
                            phase={realTimePhase}
                            intent={detectedIntent}
                        />
                    </motion.div>
                )}
            </>
        );
    }, [streamingContent, variant, showSuggestedReplies, suggestions, onSelectSuggestedReply, uiPhase, activeRunId, onRunComplete, aiState, realTimePhase, detectedIntent]);

    return (
        <div className="h-full w-full flex flex-col">
            <Virtuoso
                ref={virtuosoRef}
                data={messages}
                components={{ Footer: ListFooter }}
                initialTopMostItemIndex={messages.length - 1}
                followOutput="auto"
                alignToBottom
                className="h-full w-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40"
                itemContent={(index, msg) => (
                    <div className="pb-4 px-2">
                        <MessageItem
                            message={msg}
                            msgIndex={index}
                            totalMessages={messages.length}
                            variant={variant}
                            editingMessageId={editingMessageId}
                            editContent={editContent}
                            copiedMessageId={copiedMessageId}
                            messageFeedback={messageFeedback}
                            speakingMessageId={speakingMessageId}
                            isGeneratingImage={isGeneratingImage}
                            pendingGeneratedImage={pendingGeneratedImage}
                            latestGeneratedImageRef={latestGeneratedImageRef}
                            aiState={aiState}
                            regeneratingMsgIndex={regeneratingMsgIndex}
                            handleCopyMessage={handleCopyMessage}
                            handleStartEdit={handleStartEdit}
                            handleCancelEdit={handleCancelEdit}
                            handleSendEdit={handleSendEdit}
                            handleFeedback={handleFeedback}
                            handleRegenerate={handleRegenerate}
                            handleShare={handleShare}
                            handleReadAloud={handleReadAloud}
                            handleOpenDocumentPreview={handleOpenDocumentPreview}
                            handleOpenFileAttachmentPreview={handleOpenFileAttachmentPreview}
                            handleDownloadImage={handleDownloadImage}
                            setLightboxImage={setLightboxImage}
                            handleReopenDocument={handleReopenDocument}
                            minimizedDocument={minimizedDocument}
                            onRestoreDocument={onRestoreDocument}
                            setEditContent={setEditContent}
                            onAgentCancel={onAgentCancel}
                            onAgentRetry={onAgentRetry}
                            onAgentArtifactPreview={onAgentArtifactPreview}
                            onSuperAgentCancel={onSuperAgentCancel}
                            onSuperAgentRetry={onSuperAgentRetry}
                            onQuestionClick={onQuestionClick}
                        />
                    </div>
                )}
            />
        </div>
    );
}
