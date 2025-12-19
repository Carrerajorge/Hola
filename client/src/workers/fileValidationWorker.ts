interface ValidationMessage {
  type: 'validate';
  file: {
    name: string;
    size: number;
    type: string;
  };
  config: {
    allowedMimeTypes: string[];
    allowedExtensions: Record<string, string>;
    maxFileSize: number;
  };
}

interface ValidationResult {
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

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.slice(lastDot).toLowerCase();
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

self.onmessage = (e: MessageEvent<ValidationMessage>) => {
  const { file, config } = e.data;
  const errors: string[] = [];
  const extension = getExtension(file.name);
  
  if (!config.allowedMimeTypes.includes(file.type)) {
    const allowedTypes = config.allowedMimeTypes
      .map((t: string) => t.split('/')[1])
      .filter((t: string, i: number, arr: string[]) => arr.indexOf(t) === i)
      .slice(0, 5)
      .join(', ');
    errors.push(`Tipo de archivo no permitido. Tipos aceptados: ${allowedTypes}...`);
  }
  
  const allowedExtensions = Object.values(config.allowedExtensions);
  if (extension && !allowedExtensions.includes(extension)) {
    errors.push(`Extensión de archivo no válida: ${extension}`);
  }
  
  if (file.size > config.maxFileSize) {
    const maxSizeMB = config.maxFileSize / (1024 * 1024);
    errors.push(`El archivo excede el tamaño máximo de ${maxSizeMB}MB. Tamaño actual: ${formatFileSize(file.size)}`);
  }
  
  if (file.size === 0) {
    errors.push('El archivo está vacío');
  }
  
  const result: ValidationResult = {
    type: 'validation_result',
    valid: errors.length === 0,
    errors,
    file: {
      name: file.name,
      size: file.size,
      type: file.type,
      extension,
    },
  };
  
  self.postMessage(result);
};

export {};
