import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Trash2, Pause, Play, ArrowUp, Mic, Square, AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecordingPanelProps {
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  canSend: boolean;
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
  onToggleRecording: () => void;
  onOpenVoiceChat: () => void;
  onStopChat: () => void;
  onSubmit: () => void;
  aiState: "idle" | "thinking" | "responding" | "agent_working";
  hasContent: boolean;
  isAgentRunning?: boolean;
  onAgentStop?: () => void;
  isFilesLoading?: boolean;
}

function formatRecordingTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function RecordingPanel({
  isRecording,
  isPaused,
  recordingTime,
  canSend,
  onDiscard,
  onPause,
  onResume,
  onSend,
  onToggleRecording,
  onOpenVoiceChat,
  onStopChat,
  onSubmit,
  aiState,
  hasContent,
  isAgentRunning,
  onAgentStop,
  isFilesLoading = false,
}: RecordingPanelProps) {
  // Show stop button if either AI is processing OR agent is running
  const showStopButton = aiState !== "idle" || isAgentRunning;

  const handleStop = () => {
    if (isAgentRunning && onAgentStop) {
      onAgentStop();
    } else {
      onStopChat();
    }
  };
  if (isRecording) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="flex items-center gap-3 px-2"
        data-testid="recording-ui-compact"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDiscard}
              className={cn(
                "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
                "border-[0.5px] border-solid border-[#c7c7c7]/70 hover:border-red-400 dark:border-white/20 dark:hover:border-red-300/40",
                "bg-white/35 hover:bg-red-50 dark:bg-white/5 dark:hover:bg-red-950/30",
                "text-zinc-700 hover:text-red-600 dark:text-white/70 dark:hover:text-red-300",
                "backdrop-blur-sm shadow-none",
                "transition-colors duration-150",
                "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
              )}
              aria-label="Discard recording"
              data-testid="button-discard-recording"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Descartar grabación</TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-2">
          <motion.div
            animate={isPaused ? {} : { scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className={cn(
              "w-2.5 h-2.5 rounded-full",
              isPaused ? "bg-muted-foreground" : "bg-red-500"
            )}
          />

          <span className="text-lg font-medium tabular-nums min-w-[48px]" data-testid="recording-timer">
            {formatRecordingTime(recordingTime)}
          </span>

          <div className="flex items-center gap-0.5 h-6">
            {Array.from({ length: 20 }).map((_, i) => (
              <motion.div
                key={i}
                animate={isPaused ? { height: 4 } : {
                  height: [4, 8 + Math.random() * 12, 4, 12 + Math.random() * 8, 4]
                }}
                transition={{
                  duration: 0.5 + Math.random() * 0.3,
                  repeat: Infinity,
                  delay: i * 0.05
                }}
                className="w-0.5 bg-muted-foreground/60 rounded-full"
                style={{ height: isPaused ? 4 : undefined }}
              />
            ))}
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={isPaused ? onResume : onPause}
              className={cn(
                "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
                "border-[0.5px] border-solid border-[#c7c7c7]/70 dark:border-white/20",
                "bg-white/35 hover:bg-white/55 dark:bg-white/5 dark:hover:bg-white/8",
                "text-zinc-700 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white/90",
                "backdrop-blur-sm shadow-none",
                "transition-colors duration-150",
                "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
              )}
              aria-label={isPaused ? "Resume recording" : "Pause recording"}
              data-testid={isPaused ? "button-resume-recording" : "button-pause-recording"}
            >
              {isPaused ? (
                <Play className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pause className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPaused ? "Continuar" : "Pausar"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={onSend}
              disabled={!canSend}
              className={cn(
                "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
                "border-[0.5px] border-solid backdrop-blur-sm shadow-none",
                "transition-colors duration-150",
                "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]",
                canSend
                  ? "bg-white/35 hover:bg-white/55 border-[#c7c7c7]/70 text-zinc-700 hover:text-zinc-900 dark:bg-white/5 dark:hover:bg-white/8 dark:border-white/20 dark:text-white/70 dark:hover:text-white/90"
                  : "opacity-50 cursor-not-allowed bg-white/20 border-[#c7c7c7]/40 text-zinc-400 dark:bg-white/5 dark:border-white/10 dark:text-white/30"
              )}
              aria-label="Send message"
              data-testid="button-send-recording"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Enviar mensaje</TooltipContent>
        </Tooltip>
      </motion.div>
    );
  }

  return (
    <>
      <Tooltip>
      <TooltipTrigger asChild>
          <Button
            variant="ghost"
            onClick={onToggleRecording}
            size="icon"
            className={cn(
              "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
              "border-[0.5px] border-solid border-[#c7c7c7]/70 dark:border-white/20",
              "bg-white/35 hover:bg-white/55 dark:bg-white/5 dark:hover:bg-white/8",
              "text-zinc-700 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white/90",
              "backdrop-blur-sm shadow-none",
              "transition-colors duration-150",
              "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
            )}
            aria-label="Start voice dictation"
            data-testid="button-voice-dictation"
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dictar texto</TooltipContent>
      </Tooltip>

      {showStopButton ? (
        <Button
          onClick={handleStop}
          size="icon"
          className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50 focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label={isAgentRunning ? "Stop agent" : "Stop AI response"}
          data-testid="button-stop-chat"
        >
          <Square className="h-5 w-5 fill-current" aria-hidden="true" />
        </Button>
      ) : hasContent ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          key="send-button"
        >
          <Button
            onClick={onSubmit}
            size="icon"
            disabled={isFilesLoading}
            className={cn(
              "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
              "border-[0.5px] border-solid backdrop-blur-sm shadow-none",
              "transition-colors duration-150",
              "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]",
              isFilesLoading
                ? "opacity-50 cursor-not-allowed bg-white/20 border-[#c7c7c7]/40 text-zinc-400 dark:bg-white/5 dark:border-white/10 dark:text-white/30"
                : "bg-white/35 hover:bg-white/55 border-[#c7c7c7]/70 text-zinc-700 hover:text-zinc-900 dark:bg-white/5 dark:hover:bg-white/8 dark:border-white/20 dark:text-white/70 dark:hover:text-white/90"
            )}
            aria-label={isFilesLoading ? "Uploading files..." : "Send message (Cmd+Enter)"}
            data-testid="button-send-message"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </motion.div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onOpenVoiceChat}
              size="icon"
              className={cn(
                "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
                "border-[0.5px] border-solid border-[#c7c7c7]/70 dark:border-white/20",
                "bg-white/35 hover:bg-white/55 dark:bg-white/5 dark:hover:bg-white/8",
                "text-zinc-700 hover:text-zinc-900 dark:text-white/70 dark:hover:text-white/90",
                "backdrop-blur-sm shadow-none",
                "transition-colors duration-150",
                "focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_rgba(199,199,199,0.35)] dark:focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
              )}
              aria-label="Start voice conversation mode"
              data-testid="button-voice-chat-mode"
            >
              <AudioLines className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Modo conversación por voz</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
