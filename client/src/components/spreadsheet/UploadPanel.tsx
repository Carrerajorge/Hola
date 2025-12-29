import React, { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

interface UploadedFile {
  id: string;
  filename: string;
  sheets: string[];
  uploadedAt: string;
}

interface UploadPanelProps {
  onUploadComplete: (upload: UploadedFile) => void;
  onSheetSelect: (uploadId: string, sheetName: string) => void;
  currentUpload: UploadedFile | null;
  selectedSheet: string | null;
}

export function UploadPanel({
  onUploadComplete,
  onSheetSelect,
  currentUpload,
  selectedSheet,
}: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      
      return new Promise<UploadedFile>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percent);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch {
              reject(new Error('Invalid response from server'));
            }
          } else {
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              reject(new Error(errorResponse.message || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.open('POST', '/api/spreadsheet/upload');
        xhr.send(formData);
      });
    },
    onSuccess: (data) => {
      setUploadProgress(100);
      setError(null);
      onUploadComplete(data);
    },
    onError: (err: Error) => {
      setError(err.message);
      setUploadProgress(0);
    },
  });

  const validateFile = useCallback((file: File): string | null => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size: 25MB`;
    }
    return null;
  }, []);

  const handleFile = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setUploadProgress(0);
    uploadMutation.mutate(file);
  }, [validateFile, uploadMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFile]);

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleClearUpload = useCallback(() => {
    setError(null);
    setUploadProgress(0);
    uploadMutation.reset();
  }, [uploadMutation]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Spreadsheet Analyzer
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
            isDragging && "border-primary bg-primary/5",
            !isDragging && "border-muted-foreground/25 hover:border-muted-foreground/50",
            uploadMutation.isPending && "pointer-events-none opacity-60"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
          data-testid="upload-dropzone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileInputChange}
            className="hidden"
            data-testid="upload-input"
          />
          
          {uploadMutation.isPending ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="w-full max-w-xs">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-sm text-muted-foreground mt-2">
                  Uploading... {uploadProgress}%
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drag & drop your spreadsheet here
              </p>
              <p className="text-xs text-muted-foreground">
                or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Supports: XLSX, XLS, CSV (max 25MB)
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">{error}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={(e) => {
                e.stopPropagation();
                handleClearUpload();
              }}
              data-testid="clear-error-button"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {currentUpload && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-700 dark:text-green-400 rounded-lg">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{currentUpload.filename}</p>
                <p className="text-xs opacity-80">
                  {currentUpload.sheets.length} sheet{currentUpload.sheets.length !== 1 ? 's' : ''} found
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Select a sheet:</p>
              <div className="flex flex-col gap-1">
                {currentUpload.sheets.map((sheet) => (
                  <Button
                    key={sheet}
                    variant={selectedSheet === sheet ? "default" : "outline"}
                    className="justify-start text-left"
                    onClick={() => onSheetSelect(currentUpload.id, sheet)}
                    data-testid={`sheet-button-${sheet}`}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{sheet}</span>
                    {selectedSheet === sheet && (
                      <Badge variant="secondary" className="ml-auto">
                        Selected
                      </Badge>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
