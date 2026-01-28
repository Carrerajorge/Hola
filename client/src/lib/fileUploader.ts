export interface ValidationResult {
  type: 'validation_result';
  valid: boolean;
  errors: string[];
  file: {
    name: string;
    size: number;
    type: string;
    extension: string;
  };
}

export interface UploadProgress {
  fileId: string;
  phase: 'validating' | 'uploading' | 'processing' | 'completed' | 'error';
  uploadProgress: number;
  processingProgress: number;
  error?: string;
}

interface FileConfig {
  allowedMimeTypes: string[];
  allowedExtensions: Record<string, string>;
  maxFileSize: number;
  chunkSize: number;
  maxParallelChunks: number;
}

interface MultipartSession {
  uploadId: string;
  storagePath: string;
}

export class ChunkedFileUploader {
  private worker: Worker | null = null;
  private ws: WebSocket | null = null;
  private config: FileConfig | null = null;
  private wsReconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private wsListeners: Map<string, (status: any) => void> = new Map();
  private abortController: AbortController | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('../workers/fileValidationWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (error) {
      console.error('Failed to initialize validation worker:', error);
    }
  }

  private async fetchConfig(): Promise<FileConfig> {
    if (this.config) return this.config;
    
    const response = await fetch('/api/files/config');
    if (!response.ok) {
      throw new Error('Failed to fetch file upload configuration');
    }
    
    this.config = await response.json();
    return this.config!;
  }

  private async readFileHeaderBytes(file: File, numBytes: number = 16): Promise<number[]> {
    try {
      const slice = file.slice(0, numBytes);
      const buffer = await slice.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    } catch (error) {
      console.warn('Failed to read file header bytes:', error);
      return [];
    }
  }

  async validateFile(file: File): Promise<ValidationResult> {
    const config = await this.fetchConfig();
    const headerBytes = await this.readFileHeaderBytes(file);
    
    if (!this.worker) {
      const errors: string[] = [];
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      
      const detectedMimeType = this.detectMimeTypeFromBytes(headerBytes, file.type, extension);
      
      if (!this.isValidMimeType(detectedMimeType, file.type, config.allowedMimeTypes)) {
        errors.push('Tipo de archivo no permitido');
      }
      if (file.size > config.maxFileSize) {
        errors.push(`El archivo excede el tamaño máximo de ${config.maxFileSize / (1024 * 1024)}MB`);
      }
      if (file.size === 0) {
        errors.push('El archivo está vacío');
      }
      
      return {
        type: 'validation_result',
        valid: errors.length === 0,
        errors,
        file: { name: file.name, size: file.size, type: file.type, extension },
      };
    }

    return new Promise((resolve) => {
      const handleMessage = (e: MessageEvent<ValidationResult>) => {
        this.worker?.removeEventListener('message', handleMessage);
        resolve(e.data);
      };
      
      this.worker.addEventListener('message', handleMessage);
      this.worker.postMessage({
        type: 'validate',
        file: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
        config: {
          allowedMimeTypes: config.allowedMimeTypes,
          allowedExtensions: config.allowedExtensions,
          maxFileSize: config.maxFileSize,
        },
        headerBytes,
      });
    });
  }

  private detectMimeTypeFromBytes(headerBytes: number[], declaredType: string, extension: string): string | null {
    const MAGIC_BYTES: Record<string, number[]> = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/gif': [0x47, 0x49, 0x46, 0x38],
      'application/pdf': [0x25, 0x50, 0x44, 0x46],
      'application/zip': [0x50, 0x4B, 0x03, 0x04],
    };

    if (!headerBytes || headerBytes.length === 0) return null;

    for (const [mimeType, signature] of Object.entries(MAGIC_BYTES)) {
      if (headerBytes.length >= signature.length) {
        const matches = signature.every((byte, i) => headerBytes[i] === byte);
        if (matches) return mimeType;
      }
    }
    return null;
  }

  private isValidMimeType(detectedType: string | null, declaredType: string, allowedTypes: string[]): boolean {
    if (!detectedType) {
      return allowedTypes.includes(declaredType);
    }
    if (allowedTypes.includes(detectedType)) return true;
    
    const zipBasedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    
    if (detectedType === 'application/zip' && zipBasedTypes.includes(declaredType)) {
      return allowedTypes.some(t => zipBasedTypes.includes(t) || t === declaredType);
    }
    
    return false;
  }

  async uploadFile(
    file: File,
    onProgress: (progress: UploadProgress) => void
  ): Promise<{ fileId: string; storagePath: string }> {
    this.abortController = new AbortController();
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    try {
      onProgress({
        fileId,
        phase: 'validating',
        uploadProgress: 0,
        processingProgress: 0,
      });

      const validation = await this.validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.errors.join('. '));
      }

      onProgress({
        fileId,
        phase: 'uploading',
        uploadProgress: 0,
        processingProgress: 0,
      });

      const config = await this.fetchConfig();
      const useChunked = file.size > config.chunkSize;

      let storagePath: string;
      let actualFileId = fileId;

      if (useChunked) {
        const result = await this.uploadChunked(file, config, (percent) => {
          onProgress({
            fileId: actualFileId,
            phase: 'uploading',
            uploadProgress: percent,
            processingProgress: 0,
          });
        });
        storagePath = result.storagePath;
        if (result.fileId) {
          actualFileId = result.fileId;
        }
      } else {
        storagePath = await this.uploadSingle(file, (percent) => {
          onProgress({
            fileId: actualFileId,
            phase: 'uploading',
            uploadProgress: percent,
            processingProgress: 0,
          });
        });
      }

      onProgress({
        fileId: actualFileId,
        phase: 'processing',
        uploadProgress: 100,
        processingProgress: 0,
      });

      return { fileId: actualFileId, storagePath };
    } catch (error: any) {
      onProgress({
        fileId,
        phase: 'error',
        uploadProgress: 0,
        processingProgress: 0,
        error: error.message || 'Error al subir el archivo',
      });
      throw error;
    }
  }

  private async uploadSingle(
    file: File,
    onProgress: (percent: number) => void
  ): Promise<string> {
    const response = await fetch('/api/objects/upload', { method: 'POST' });
    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }
    
    const { uploadURL, storagePath } = await response.json();

    await this.uploadWithProgress(uploadURL, file, onProgress);
    
    return storagePath;
  }

  private async uploadChunked(
    file: File,
    config: FileConfig,
    onProgress: (percent: number) => void
  ): Promise<{ storagePath: string; fileId?: string }> {
    const totalChunks = Math.ceil(file.size / config.chunkSize);

    const createResponse = await fetch('/api/objects/multipart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        totalChunks,
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.json();
      throw new Error(error.error || 'Failed to create multipart upload');
    }

    const session: MultipartSession = await createResponse.json();
    const uploadedParts: { partNumber: number; etag?: string }[] = [];
    let completedChunks = 0;

    const uploadChunk = async (partNumber: number): Promise<void> => {
      const start = (partNumber - 1) * config.chunkSize;
      const end = Math.min(start + config.chunkSize, file.size);
      const chunk = file.slice(start, end);

      const signResponse = await fetch('/api/objects/multipart/sign-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: session.uploadId,
          partNumber,
        }),
      });

      if (!signResponse.ok) {
        throw new Error(`Failed to sign part ${partNumber}`);
      }

      const { signedUrl } = await signResponse.json();

      await this.uploadWithProgress(signedUrl, chunk, () => {});

      uploadedParts.push({ partNumber });
      completedChunks++;
      onProgress(Math.round((completedChunks / totalChunks) * 100));
    };

    const chunkNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1);

    for (let i = 0; i < chunkNumbers.length; i += config.maxParallelChunks) {
      const batch = chunkNumbers.slice(i, i + config.maxParallelChunks);
      await Promise.all(batch.map(uploadChunk));
    }

    const completeResponse = await fetch('/api/objects/multipart/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: session.uploadId,
        parts: uploadedParts.sort((a, b) => a.partNumber - b.partNumber),
      }),
    });

    if (!completeResponse.ok) {
      throw new Error('Failed to complete multipart upload');
    }

    const result = await completeResponse.json();
    return { storagePath: result.storagePath, fileId: result.fileId };
  }

  private uploadWithProgress(
    url: string,
    data: Blob,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      xhr.open('PUT', url);
      xhr.send(data);

      if (this.abortController) {
        this.abortController.signal.addEventListener('abort', () => {
          xhr.abort();
        });
      }
    });
  }

  subscribeToProcessingStatus(
    fileId: string,
    onStatus: (status: any) => void
  ): () => void {
    this.wsListeners.set(fileId, onStatus);
    this.ensureWebSocketConnection();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', fileId }));
    }

    return () => {
      this.wsListeners.delete(fileId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'unsubscribe', fileId }));
      }
    };
  }

  private ensureWebSocketConnection(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/file-status`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.wsReconnectAttempts = 0;
      this.wsListeners.forEach((_, fileId) => {
        this.ws?.send(JSON.stringify({ type: 'subscribe', fileId }));
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'file_status' && data.fileId) {
          const listener = this.wsListeners.get(data.fileId);
          if (listener) {
            listener(data);
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      if (this.wsListeners.size > 0 && this.wsReconnectAttempts < this.maxReconnectAttempts) {
        this.wsReconnectAttempts++;
        setTimeout(() => this.ensureWebSocketConnection(), 1000 * this.wsReconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ws?.close();
    this.ws = null;
    this.wsListeners.clear();
    this.abortController?.abort();
  }
}

let uploaderInstance: ChunkedFileUploader | null = null;

export function getFileUploader(): ChunkedFileUploader {
  if (!uploaderInstance) {
    uploaderInstance = new ChunkedFileUploader();
  }
  return uploaderInstance;
}
