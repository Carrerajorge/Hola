
import React, { memo } from "react";
import {
    X,
    Send,
    Pencil,
    Copy,
    CheckCircle2,
    Loader2,
    CheckCheck,
    AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { Message } from "@/hooks/use-chats";
import { AttachmentList, formatMessageTime, DocumentBlock } from "./MessageParts";

export interface UserMessageProps {
    message: Message;
    sendTransitionLayoutId?: string;
    variant: "compact" | "default";
    isEditing: boolean;
    editContent: string;
    copiedMessageId: string | null;
    onEditContentChange: (value: string) => void;
    onCancelEdit: () => void;
    onSendEdit: (id: string) => void;
    onCopyMessage: (content: string, id: string) => void;
    onStartEdit: (msg: Message) => void;
    onOpenPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
    onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
    onRetrySend?: (msg: Message) => void;
    documentAnalysisStatus?: { state: "processing" | "error"; text: string };
}

export const UserMessage = memo(function UserMessage({
    message,
    sendTransitionLayoutId,
    variant,
    isEditing,
    editContent,
    copiedMessageId,
    onEditContentChange,
    onCancelEdit,
    onSendEdit,
    onCopyMessage,
    onStartEdit,
    onOpenPreview,
    onReopenDocument,
    onRetrySend,
    documentAnalysisStatus
}: UserMessageProps) {
    const { settings: platformSettings } = usePlatformSettings();
    const isSending = message.deliveryStatus === "sending";
    const hasDocumentAttachments = !!message.attachments?.some((att) => {
        const attachmentType = (att.type || "").toLowerCase();
        const attachmentMime = (att.mimeType || "").toLowerCase();
        const attachmentName = (att.name || "").toLowerCase();

        if (attachmentType && attachmentType !== "image") return true;
        if (attachmentMime && !attachmentMime.startsWith("image/")) return true;
        return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf|odt|ods|odp|json)$/i.test(attachmentName);
    });
    const showDocumentAnalysisIndicator = hasDocumentAttachments && documentAnalysisStatus?.state === "processing";

    if (variant === "compact") {
        return (
            <div className="flex flex-col items-end gap-1 max-w-full">
                {message.attachments && message.attachments.length > 0 && (
                    <AttachmentList
                        attachments={message.attachments}
                        variant={variant}
                        onOpenPreview={onOpenPreview}
                        onReopenDocument={onReopenDocument}
                    />
                )}
                {showDocumentAnalysisIndicator && (
                    <DocumentAnalysisInlineStatus text={documentAnalysisStatus.text} />
                )}
                {message.content && (
                    <motion.div
                        layout={sendTransitionLayoutId ? "position" : false}
                        layoutId={sendTransitionLayoutId}
                        transition={SEND_TRANSITION_SPRING}
                        className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm"
                        style={{ transformOrigin: "right bottom" }}
                    >
                        <span className="text-muted-foreground mr-1 font-medium">
                            Instrucción:
                        </span>
                        <span className="text-foreground">{message.content}</span>
                    </motion.div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-end gap-1">
            {isEditing ? (
                <div className="w-full min-w-[300px] max-w-[500px]">
                    <Textarea
                        value={editContent}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onEditContentChange(e.target.value)}
                        className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-border bg-card focus:border-primary focus:ring-1 focus:ring-primary"
                        autoFocus
                    />
                    <div className="flex items-center justify-end gap-2 mt-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                            onClick={onCancelEdit}
                        >
                            <X className="h-4 w-4 mr-1" />
                            Cancelar
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                            onClick={() => onSendEdit(message.id)}
                        >
                            <Send className="h-4 w-4 mr-1" />
                            Enviar
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="group">
                    <AttachmentList
                        attachments={message.attachments}
                        variant={variant}
                        onOpenPreview={onOpenPreview}
                        onReopenDocument={onReopenDocument}
                    />
                    {showDocumentAnalysisIndicator && (
                        <DocumentAnalysisInlineStatus text={documentAnalysisStatus.text} />
                    )}
                    {message.content && (
                        <motion.div
                            layout={sendTransitionLayoutId ? "position" : false}
                            layoutId={sendTransitionLayoutId}
                            transition={SEND_TRANSITION_SPRING}
                            className={cn(
                                "liquid-message-user px-4 py-2.5 text-sm break-words leading-relaxed transition-[box-shadow,border-color,transform,opacity] duration-200",
                                isSending &&
                                    "ring-1 ring-primary/10 shadow-[0_12px_30px_-22px_rgba(59,130,246,0.55)]",
                            )}
                            style={{ transformOrigin: "right bottom" }}
                        >
                            {message.content}
                        </motion.div>
                    )}
                    <div className="flex items-center justify-end gap-1.5 mt-2">
                        {message.timestamp && (
                            <span className="text-[10px] text-muted-foreground/60 mr-1">
                                {formatMessageTime(message.timestamp, platformSettings.timezone_default)}
                            </span>
                        )}
                        <DeliveryStatusBadge status={message.deliveryStatus} />
                        {message.deliveryStatus === "error" && (
                            <div className="flex items-center gap-2">
                                {onRetrySend && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                                        onClick={() => onRetrySend(message)}
                                    >
                                        Reintentar
                                    </Button>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => onCopyMessage(message.content, message.id)}
                                data-testid={`button-copy-user-${message.id}`}
                                title="Copiar mensaje"
                                aria-label="Copiar mensaje"
                            >
                                {copiedMessageId === message.id ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => onStartEdit(message)}
                                data-testid={`button-edit-user-${message.id}`}
                                title="Editar mensaje"
                                aria-label="Editar mensaje"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.message.id === nextProps.message.id &&
        prevProps.message.clientTempId === nextProps.message.clientTempId &&
        prevProps.sendTransitionLayoutId === nextProps.sendTransitionLayoutId &&
        prevProps.message.content === nextProps.message.content &&
        prevProps.message.deliveryStatus === nextProps.message.deliveryStatus &&
        prevProps.message.deliveryError === nextProps.message.deliveryError &&
        prevProps.variant === nextProps.variant &&
        prevProps.isEditing === nextProps.isEditing &&
        prevProps.editContent === nextProps.editContent &&
        prevProps.copiedMessageId === nextProps.copiedMessageId &&
        prevProps.message.attachments === nextProps.message.attachments &&
        prevProps.documentAnalysisStatus?.state === nextProps.documentAnalysisStatus?.state &&
        prevProps.documentAnalysisStatus?.text === nextProps.documentAnalysisStatus?.text
    );
});

const SEND_TRANSITION_SPRING = {
    type: "spring" as const,
    stiffness: 460,
    damping: 36,
    mass: 0.82,
};

const DELIVERY_STATUS_BADGE_CLASSNAME =
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm";

const DeliveryStatusBadge = memo(function DeliveryStatusBadge({
    status,
}: {
    status: Message["deliveryStatus"];
}) {
    if (!status) return null;

    if (status === "error") {
        return (
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                    key="error"
                    initial={{ opacity: 0, y: 3, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -3, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className={cn(
                        DELIVERY_STATUS_BADGE_CLASSNAME,
                        "border-destructive/20 bg-destructive/5 text-destructive",
                    )}
                    aria-live="polite"
                >
                    <AlertCircle className="h-3 w-3" />
                    <span>Error</span>
                </motion.span>
            </AnimatePresence>
        );
    }

    const badgeContent =
        status === "sending"
            ? {
                  key: "sending",
                  className: "border-primary/15 bg-primary/5 text-primary/80",
                  label: "Enviando",
                  icon: (
                      <motion.span
                          className="h-1.5 w-1.5 rounded-full bg-primary"
                          animate={{ scale: [1, 1.25, 1], opacity: [0.55, 1, 0.55] }}
                          transition={{ duration: 1.15, ease: "easeInOut", repeat: Infinity }}
                      />
                  ),
              }
            : status === "delivered"
              ? {
                    key: "delivered",
                    className: "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
                    label: "Entregado",
                    icon: <CheckCheck className="h-3 w-3" />,
                }
              : {
                    key: "sent",
                    className: "border-zinc-200/70 bg-white/70 text-muted-foreground dark:border-zinc-700/70 dark:bg-zinc-900/50",
                    label: "Enviado",
                    icon: <CheckCircle2 className="h-3 w-3" />,
                };

    return (
        <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
                key={badgeContent.key}
                initial={{ opacity: 0, y: 3, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -3, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className={cn(DELIVERY_STATUS_BADGE_CLASSNAME, badgeContent.className)}
                aria-live="polite"
            >
                {badgeContent.icon}
                <span>{badgeContent.label}</span>
            </motion.span>
        </AnimatePresence>
    );
});

const DocumentAnalysisInlineStatus = memo(function DocumentAnalysisInlineStatus({
    text,
}: {
    text: string;
}) {
    return (
        <div className="mt-1 flex justify-end">
            <div className="relative overflow-hidden rounded-full border border-cyan-300/40 bg-cyan-50/70 dark:bg-cyan-900/20 px-3 py-1.5 text-[11px] text-cyan-700 dark:text-cyan-200 shadow-sm backdrop-blur-sm">
                <motion.span
                    aria-hidden
                    className="pointer-events-none absolute -inset-y-1 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent dark:via-cyan-400/35 blur-[2px]"
                    animate={{ x: ["-10%", "260%"] }}
                    transition={{ duration: 1.8, ease: "linear", repeat: Infinity }}
                />
                <div className="relative z-10 flex items-center gap-1.5">
                    <Loader2 className={cn("h-3.5 w-3.5 animate-spin")} />
                    <span>{text || "Analizando documentos adjuntos..."}</span>
                </div>
            </div>
        </div>
    );
});
