/**
 * Compression middleware with gzip/brotli support.
 * Automatically compresses responses based on Accept-Encoding header.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createGzip, createBrotliCompress, constants } from "zlib";
import { Transform, TransformCallback } from "stream";

const MIN_COMPRESSION_SIZE = parseInt(process.env.COMPRESSION_MIN_SIZE || "1024", 10);
const COMPRESSION_LEVEL = parseInt(process.env.COMPRESSION_LEVEL || "6", 10);
const BROTLI_QUALITY = parseInt(process.env.BROTLI_QUALITY || "4", 10);

const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/json",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/xhtml+xml",
  "application/x-font-ttf",
  "application/x-font-opentype",
  "application/vnd.ms-fontobject",
  "image/svg+xml",
  "image/x-icon",
  "font/ttf",
  "font/otf",
  "font/eot",
]);

const EXCLUDED_PATHS = new Set([
  "/api/sse",
  "/api/stream",
  "/health",
  "/metrics",
]);

export interface CompressionOptions {
  level?: number;
  brotliQuality?: number;
  threshold?: number;
  filter?: (req: Request, res: Response) => boolean;
  excludePaths?: string[];
  preferBrotli?: boolean;
}

interface CompressionStats {
  compressedResponses: number;
  uncompressedResponses: number;
  bytesSaved: number;
  gzipCount: number;
  brotliCount: number;
  skippedCount: number;
}

const stats: CompressionStats = {
  compressedResponses: 0,
  uncompressedResponses: 0,
  bytesSaved: 0,
  gzipCount: 0,
  brotliCount: 0,
  skippedCount: 0,
};

function parseAcceptEncoding(header: string | undefined): { gzip: boolean; br: boolean; priority: "br" | "gzip" | null } {
  if (!header) {
    return { gzip: false, br: false, priority: null };
  }

  const encodings = header.toLowerCase().split(",").map((e) => e.trim());
  const result = { gzip: false, br: false, priority: null as "br" | "gzip" | null };

  let gzipQ = 0;
  let brQ = 0;

  for (const encoding of encodings) {
    const [name, ...params] = encoding.split(";").map((p) => p.trim());
    let quality = 1;

    for (const param of params) {
      if (param.startsWith("q=")) {
        quality = parseFloat(param.substring(2)) || 0;
      }
    }

    if (name === "gzip" && quality > 0) {
      result.gzip = true;
      gzipQ = quality;
    } else if (name === "br" && quality > 0) {
      result.br = true;
      brQ = quality;
    }
  }

  if (result.br && result.gzip) {
    result.priority = brQ >= gzipQ ? "br" : "gzip";
  } else if (result.br) {
    result.priority = "br";
  } else if (result.gzip) {
    result.priority = "gzip";
  }

  return result;
}

function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const type = contentType.split(";")[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.has(type);
}

function shouldCompress(
  req: Request,
  res: Response,
  options: CompressionOptions
): boolean {
  const path = req.path;
  const excludedPaths = options.excludePaths || Array.from(EXCLUDED_PATHS);
  
  for (const excluded of excludedPaths) {
    if (path.startsWith(excluded)) {
      return false;
    }
  }

  if (options.filter && !options.filter(req, res)) {
    return false;
  }

  if (req.method === "HEAD") {
    return false;
  }

  const cacheControl = res.get("Cache-Control");
  if (cacheControl && cacheControl.includes("no-transform")) {
    return false;
  }

  const contentEncoding = res.get("Content-Encoding");
  if (contentEncoding && contentEncoding !== "identity") {
    return false;
  }

  return true;
}

class CompressionStream extends Transform {
  private chunks: Buffer[] = [];
  private totalSize = 0;
  private compressed = false;
  private encoding: "gzip" | "br" | null = null;
  private compressor: ReturnType<typeof createGzip> | ReturnType<typeof createBrotliCompress> | null = null;
  private res: Response;
  private options: CompressionOptions;
  private acceptedEncodings: { gzip: boolean; br: boolean; priority: "br" | "gzip" | null };

  constructor(
    res: Response,
    options: CompressionOptions,
    acceptedEncodings: { gzip: boolean; br: boolean; priority: "br" | "gzip" | null }
  ) {
    super();
    this.res = res;
    this.options = options;
    this.acceptedEncodings = acceptedEncodings;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.chunks.push(chunk);
    this.totalSize += chunk.length;
    callback();
  }

  _flush(callback: TransformCallback): void {
    const threshold = this.options.threshold || MIN_COMPRESSION_SIZE;
    const contentType = this.res.get("Content-Type");

    if (this.totalSize < threshold || !isCompressible(contentType)) {
      stats.uncompressedResponses++;
      for (const chunk of this.chunks) {
        this.push(chunk);
      }
      callback();
      return;
    }

    const preferBrotli = this.options.preferBrotli !== false;
    
    if (preferBrotli && this.acceptedEncodings.br) {
      this.encoding = "br";
    } else if (this.acceptedEncodings.gzip) {
      this.encoding = "gzip";
    } else if (this.acceptedEncodings.br) {
      this.encoding = "br";
    }

    if (!this.encoding) {
      stats.uncompressedResponses++;
      for (const chunk of this.chunks) {
        this.push(chunk);
      }
      callback();
      return;
    }

    const originalSize = this.totalSize;
    const fullData = Buffer.concat(this.chunks);

    if (this.encoding === "br") {
      this.compressor = createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: this.options.brotliQuality || BROTLI_QUALITY,
        },
      });
      stats.brotliCount++;
    } else {
      this.compressor = createGzip({
        level: this.options.level || COMPRESSION_LEVEL,
      });
      stats.gzipCount++;
    }

    this.res.removeHeader("Content-Length");
    this.res.setHeader("Content-Encoding", this.encoding);
    this.res.setHeader("Vary", "Accept-Encoding");

    const compressedChunks: Buffer[] = [];

    this.compressor.on("data", (chunk: Buffer) => {
      compressedChunks.push(chunk);
    });

    this.compressor.on("end", () => {
      const compressedData = Buffer.concat(compressedChunks);
      const savedBytes = originalSize - compressedData.length;

      stats.compressedResponses++;
      stats.bytesSaved += savedBytes;

      this.push(compressedData);
      callback();
    });

    this.compressor.on("error", (err) => {
      console.error("[Compression] Error:", err.message);
      for (const chunk of this.chunks) {
        this.push(chunk);
      }
      callback();
    });

    this.compressor.end(fullData);
  }
}

export function compression(options: CompressionOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const acceptEncoding = req.get("Accept-Encoding");
    const acceptedEncodings = parseAcceptEncoding(acceptEncoding);

    if (!acceptedEncodings.gzip && !acceptedEncodings.br) {
      stats.skippedCount++;
      return next();
    }

    if (!shouldCompress(req, res, options)) {
      stats.skippedCount++;
      return next();
    }

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    const compressionStream = new CompressionStream(res, options, acceptedEncodings);

    let ended = false;
    const chunks: Buffer[] = [];

    res.write = function (
      chunk: any,
      encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void
    ): boolean {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
      }
      
      if (typeof encodingOrCallback === "function") {
        encodingOrCallback(null);
        return true;
      }
      
      if (callback) {
        callback(null);
      }
      
      return true;
    };

    res.end = function (
      chunk?: any,
      encodingOrCallback?: BufferEncoding | (() => void),
      callback?: () => void
    ): Response {
      if (ended) {
        return res;
      }
      ended = true;

      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
      }

      for (const c of chunks) {
        compressionStream.write(c);
      }

      compressionStream.end();

      const compressedChunks: Buffer[] = [];

      compressionStream.on("data", (data: Buffer) => {
        compressedChunks.push(data);
      });

      compressionStream.on("end", () => {
        const result = Buffer.concat(compressedChunks);
        originalWrite(result);
        (originalEnd as any)();
        
        if (typeof encodingOrCallback === "function") {
          encodingOrCallback();
        } else if (callback) {
          callback();
        }
      });

      compressionStream.on("error", () => {
        const originalData = Buffer.concat(chunks);
        originalWrite(originalData);
        (originalEnd as any)();
      });

      return res;
    };

    next();
  };
}

export function getCompressionStats(): CompressionStats & { 
  compressionRatio: number;
  averageSavedPerResponse: number;
} {
  const ratio = stats.compressedResponses > 0
    ? stats.bytesSaved / (stats.bytesSaved + stats.compressedResponses * 1000)
    : 0;
  
  const avgSaved = stats.compressedResponses > 0
    ? stats.bytesSaved / stats.compressedResponses
    : 0;

  return {
    ...stats,
    compressionRatio: Math.round(ratio * 100) / 100,
    averageSavedPerResponse: Math.round(avgSaved),
  };
}

export function resetCompressionStats(): void {
  stats.compressedResponses = 0;
  stats.uncompressedResponses = 0;
  stats.bytesSaved = 0;
  stats.gzipCount = 0;
  stats.brotliCount = 0;
  stats.skippedCount = 0;
}

export function gzipOnly(options: Omit<CompressionOptions, "preferBrotli"> = {}): RequestHandler {
  return compression({
    ...options,
    filter: (req, res) => {
      const acceptEncoding = req.get("Accept-Encoding");
      if (!acceptEncoding || !acceptEncoding.includes("gzip")) {
        return false;
      }
      return options.filter ? options.filter(req, res) : true;
    },
  });
}

export function brotliOnly(options: Omit<CompressionOptions, "preferBrotli"> = {}): RequestHandler {
  return compression({
    ...options,
    preferBrotli: true,
    filter: (req, res) => {
      const acceptEncoding = req.get("Accept-Encoding");
      if (!acceptEncoding || !acceptEncoding.includes("br")) {
        return false;
      }
      return options.filter ? options.filter(req, res) : true;
    },
  });
}

export function conditionalCompression(
  condition: (req: Request) => boolean,
  options: CompressionOptions = {}
): RequestHandler {
  const compressionMiddleware = compression(options);
  
  return (req: Request, res: Response, next: NextFunction): void => {
    if (condition(req)) {
      return compressionMiddleware(req, res, next);
    }
    next();
  };
}
