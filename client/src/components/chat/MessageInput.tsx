import React, { memo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Paperclip, ArrowUp, X, FileText, Loader2 } from "lucide-react";
import type { UploadedFile } from "@/hooks/chat/useAttachmentPipeline";

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  files?: UploadedFile[];
  onFileSelect?: (files: FileList | null) => void;
  onRemoveFile?: (fileId: string) => void;
  isUploading?: boolean;
  className?: string;
}

export const MessageInput = memo(function MessageInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Escribe un mensaje...",
  disabled = false,
  isLoading = false,
  files = [],
  onFileSelect,
  onRemoveFile,
  isUploading = false,
  className,
}: MessageInputProps) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);
  
  const canSubmit = value.trim().length > 0 && !disabled && !isLoading;
  
  return (
    <div className={cn("relative flex flex-col gap-2", className)}>
      {/* File attachments preview */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-lg">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-background rounded-md border text-sm"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="max-w-[150px] truncate">{file.name}</span>
              {file.status === "uploading" && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {onRemoveFile && file.status !== "uploading" && (
                <button
                  onClick={() => onRemoveFile(file.id)}
                  className="ml-1 p-0.5 hover:bg-muted rounded"
                  disabled={isUploading}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      
      <div className="relative flex items-end gap-2">
        {/* File attachment button */}
        {onFileSelect && (
          <label className="flex-shrink-0">
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFileSelect(e.target.files)}
              disabled={disabled || isUploading}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              disabled={disabled || isUploading}
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          </label>
        )}
        
        {/* Text input */}
        <Textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isUploading}
          className="min-h-[50px] max-h-[200px] resize-none bg-muted/50 border-0 focus-visible:ring-1"
          rows={1}
        />
        
        {/* Send button */}
        <Button
          type="submit"
          size="icon"
          disabled={!canSubmit}
          onClick={onSubmit}
          className={cn(
            "h-10 w-10 rounded-full transition-all",
            canSubmit
              ? "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowUp className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
});
