import { useState, useCallback, useRef, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { chatLogger } from "@/lib/logger";
import { getFileUploader } from "@/lib/fileUploader";
import { apiFetch } from "@/lib/apiClient";

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  url?: string;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
  error?: string;
}

export interface UseAttachmentPipelineProps {
  chatId: string;
  user: { id: string } | null;
  maxFiles?: number;
  maxSize?: number; // in bytes
}

export interface UseAttachmentPipelineReturn {
  files: UploadedFile[];
  isUploading: boolean;
  totalProgress: number;
  inputRef: React.RefObject<HTMLInputElement>;
  
  // Actions
  addFiles: (files: FileList | null) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  uploadFiles: () => Promise<UploadedFile[]>;
  retryFile: (fileId: string) => Promise<void>;
}

const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100MB

export function useAttachmentPipeline({
  chatId,
  user,
  maxFiles = DEFAULT_MAX_FILES,
  maxSize = DEFAULT_MAX_SIZE,
}: UseAttachmentPipelineProps): UseAttachmentPipelineReturn {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  
  const totalProgress = useMemo(() => {
    if (files.length === 0) return 0;
    const total = files.reduce((acc, f) => acc + f.progress, 0);
    return Math.round(total / files.length);
  }, [files]);
  
  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    
    const newFiles: UploadedFile[] = [];
    const errors: string[] = [];
    
    Array.from(fileList).forEach((file, index) => {
      if (files.length + newFiles.length >= maxFiles) {
        errors.push(`Límite de ${maxFiles} archivos alcanzado`);
        return;
      }
      
      if (file.size > maxSize) {
        errors.push(`${file.name} excede el tamaño máximo (${Math.round(maxSize / 1024 / 1024)}MB)`);
        return;
      }
      
      newFiles.push({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        progress: 0,
        status: "pending",
      });
    });
    
    if (errors.length > 0) {
      toast({
        title: "Error al adjuntar archivos",
        description: errors.join("\n"),
        variant: "destructive",
      });
    }
    
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
      chatLogger.info("Files added", { count: newFiles.length, chatId });
    }
  }, [files.length, maxFiles, maxSize, chatId, toast]);
  
  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    chatLogger.debug("File removed", { fileId });
  }, []);
  
  const clearFiles = useCallback(() => {
    setFiles([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);
  
  const updateFileProgress = useCallback((fileId: string, progress: number) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, progress } : f))
    );
  }, []);
  
  const updateFileStatus = useCallback((
    fileId: string,
    status: UploadedFile["status"],
    url?: string,
    error?: string
  ) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, status, url, error, progress: status === "completed" ? 100 : f.progress } : f
      )
    );
  }, []);
  
  const uploadSingleFile = useCallback(async (file: UploadedFile): Promise<UploadedFile> => {
    updateFileStatus(file.id, "uploading");
    
    try {
      const uploader = getFileUploader();
      
      // Request upload URL
      const response = await apiFetch("/api/uploads/request-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          chatId,
        }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to get upload URL");
      }
      
      const { uploadUrl, fileId: serverFileId } = await response.json();
      
      // Upload with progress tracking
      await uploader.upload(file.file, uploadUrl, {
        onProgress: (progress) => {
          updateFileProgress(file.id, progress);
        },
      });
      
      // Get final URL
      const finalUrl = `${uploadUrl.split("?")[0]}/${serverFileId}`;
      
      updateFileStatus(file.id, "completed", finalUrl);
      
      chatLogger.info("File uploaded", { fileId: file.id, name: file.name });
      
      return { ...file, status: "completed", url: finalUrl };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      updateFileStatus(file.id, "error", undefined, error.message);
      chatLogger.error("File upload failed", error);
      throw error;
    }
  }, [chatId, updateFileProgress, updateFileStatus]);
  
  const uploadFiles = useCallback(async (): Promise<UploadedFile[]> => {
    if (files.length === 0) return [];
    
    setIsUploading(true);
    chatLogger.info("Starting batch upload", { count: files.length });
    
    const results: UploadedFile[] = [];
    const errors: string[] = [];
    
    for (const file of files) {
      if (file.status === "completed") {
        results.push(file);
        continue;
      }
      
      try {
        const uploaded = await uploadSingleFile(file);
        results.push(uploaded);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    setIsUploading(false);
    
    if (errors.length > 0) {
      toast({
        title: "Algunos archivos no se pudieron subir",
        description: errors.join("\n"),
        variant: "destructive",
      });
    }
    
    return results;
  }, [files, uploadSingleFile, toast]);
  
  const retryFile = useCallback(async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    
    await uploadSingleFile(file);
  }, [files, uploadSingleFile]);
  
  return {
    files,
    isUploading,
    totalProgress,
    inputRef,
    addFiles,
    removeFile,
    clearFiles,
    uploadFiles,
    retryFile,
  };
}


