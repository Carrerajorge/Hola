/**
 * DATA_MODE Output Kill-Switch
 * 
 * Validates that responses in DATA_MODE contain no image/artifact fields.
 * If violation detected → logs error with stack trace and throws DATA_MODE_OUTPUT_VIOLATION.
 */

export interface DataModeValidationResult {
  valid: boolean;
  violations: string[];
  stack?: string;
}

const FORBIDDEN_KEYS = [
  'image',
  'images',
  'artifact',
  'artifacts',
  'image_url',
  'imageUrl',
  'image_data',
  'imageData',
  'generated_image',
  'generatedImage',
  'download_url',
  'downloadUrl',
  'file_download',
  'fileDownload',
  'media_url',
  'mediaUrl',
  'binary_data',
  'binaryData',
];

const FORBIDDEN_CONTENT_TYPES = [
  'image/',
  'application/octet-stream',
];

const FORBIDDEN_TEXT_PATTERNS = [
  /he generado una imagen/i,
  /i have generated an image/i,
  /aquí está la imagen/i,
  /here is the image/i,
  /imagen generada/i,
  /generated image/i,
  /creé una imagen/i,
  /i created an image/i,
  /![.*]\(.*\)/,  // Markdown image syntax
  /data:image\//i,  // Base64 image
];

/**
 * Recursively scan an object for forbidden keys
 */
function scanForForbiddenKeys(obj: any, path: string = ''): string[] {
  const violations: string[] = [];
  
  if (obj === null || obj === undefined) {
    return violations;
  }
  
  if (typeof obj !== 'object') {
    return violations;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      violations.push(...scanForForbiddenKeys(item, `${path}[${index}]`));
    });
    return violations;
  }
  
  for (const key of Object.keys(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    // Check for forbidden keys
    for (const forbidden of FORBIDDEN_KEYS) {
      if (lowerKey === forbidden.toLowerCase() || lowerKey.includes(forbidden.toLowerCase())) {
        violations.push(`Forbidden key "${key}" at path "${currentPath}"`);
      }
    }
    
    // Check for forbidden content-type values
    if (lowerKey === 'content-type' || lowerKey === 'contenttype' || lowerKey === 'mimetype') {
      const value = String(obj[key]).toLowerCase();
      for (const forbidden of FORBIDDEN_CONTENT_TYPES) {
        if (value.startsWith(forbidden)) {
          violations.push(`Forbidden content-type "${obj[key]}" at path "${currentPath}"`);
        }
      }
    }
    
    // Recursively scan nested objects
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      violations.push(...scanForForbiddenKeys(obj[key], currentPath));
    }
  }
  
  return violations;
}

/**
 * Scan text content for forbidden patterns indicating image generation
 */
function scanTextForViolations(text: string, fieldName: string): string[] {
  const violations: string[] = [];
  
  if (typeof text !== 'string') {
    return violations;
  }
  
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Forbidden text pattern "${pattern}" found in "${fieldName}"`);
    }
  }
  
  return violations;
}

/**
 * Validate a DATA_MODE response payload
 * Returns validation result with any violations found
 */
export function validateDataModeResponse(payload: any, requestId: string): DataModeValidationResult {
  const violations: string[] = [];
  
  // Scan for forbidden keys in the entire payload
  violations.push(...scanForForbiddenKeys(payload));
  
  // Scan text fields for forbidden patterns
  if (payload.answer_text) {
    violations.push(...scanTextForViolations(payload.answer_text, 'answer_text'));
  }
  if (payload.answerText) {
    violations.push(...scanTextForViolations(payload.answerText, 'answerText'));
  }
  if (payload.message) {
    violations.push(...scanTextForViolations(payload.message, 'message'));
  }
  if (payload.content) {
    violations.push(...scanTextForViolations(payload.content, 'content'));
  }
  
  // Check per_doc_findings for violations
  if (payload.per_doc_findings) {
    for (const [docName, findings] of Object.entries(payload.per_doc_findings)) {
      if (Array.isArray(findings)) {
        for (const finding of findings) {
          if (typeof finding === 'string') {
            violations.push(...scanTextForViolations(finding, `per_doc_findings.${docName}`));
          }
        }
      }
    }
  }
  
  if (violations.length > 0) {
    const stack = new Error().stack;
    console.error(`[DATA_MODE_KILL_SWITCH] ========== VIOLATION DETECTED ==========`);
    console.error(`[DATA_MODE_KILL_SWITCH] requestId: ${requestId}`);
    console.error(`[DATA_MODE_KILL_SWITCH] violations: ${violations.length}`);
    violations.forEach((v, i) => console.error(`[DATA_MODE_KILL_SWITCH] [${i + 1}] ${v}`));
    console.error(`[DATA_MODE_KILL_SWITCH] stack: ${stack}`);
    
    return {
      valid: false,
      violations,
      stack
    };
  }
  
  return { valid: true, violations: [] };
}

/**
 * Error class for DATA_MODE output violations
 */
export class DataModeOutputViolationError extends Error {
  public readonly violations: string[];
  public readonly requestId: string;
  
  constructor(requestId: string, violations: string[]) {
    super(`DATA_MODE_OUTPUT_VIOLATION: ${violations.length} violation(s) detected`);
    this.name = 'DataModeOutputViolationError';
    this.violations = violations;
    this.requestId = requestId;
  }
}

/**
 * Validate and throw if violations found
 * Use this before sending any DATA_MODE response
 */
export function assertDataModeCompliance(payload: any, requestId: string): void {
  const result = validateDataModeResponse(payload, requestId);
  
  if (!result.valid) {
    throw new DataModeOutputViolationError(requestId, result.violations);
  }
}
