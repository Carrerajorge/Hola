/**
 * Parser Registry - Extensible parser management with circuit breaker
 * PARE Phase 2 Security Hardening
 * 
 * Provides a centralized registry for document parsers with:
 * - Priority-based parser selection
 * - Circuit breaker pattern for fault tolerance
 * - Fallback to text extraction on parse failures
 */

import type { FileParser, ParsedResult, DetectedFileType } from "../parsers/base";

export interface ParserRegistration {
  parser: FileParser;
  mimeTypes: string[];
  priority: number;
  options?: ParserOptions;
}

export interface ParserOptions {
  maxRetries?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
  fallbackEnabled?: boolean;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  totalCalls: number;
  totalFailures: number;
}

export interface ParseAttemptResult {
  success: boolean;
  result?: ParsedResult;
  error?: string;
  parserUsed: string;
  fallbackUsed: boolean;
  circuitBreakerTripped: boolean;
}

const DEFAULT_OPTIONS: Required<ParserOptions> = {
  maxRetries: 1,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
  fallbackEnabled: true,
};

export class ParserRegistry {
  private registrations: Map<string, ParserRegistration[]> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private fallbackParser: FileParser | null = null;
  private globalOptions: Required<ParserOptions>;

  constructor(options?: Partial<ParserOptions>) {
    this.globalOptions = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register a parser for specific MIME types
   */
  registerParser(
    mimeTypes: string[],
    parser: FileParser,
    priority: number = 100,
    options?: ParserOptions
  ): void {
    const registration: ParserRegistration = {
      parser,
      mimeTypes,
      priority,
      options: { ...this.globalOptions, ...options },
    };

    for (const mimeType of mimeTypes) {
      const existing = this.registrations.get(mimeType) || [];
      existing.push(registration);
      existing.sort((a, b) => a.priority - b.priority);
      this.registrations.set(mimeType, existing);
    }

    this.circuitBreakers.set(parser.name, {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      totalCalls: 0,
      totalFailures: 0,
    });

    console.log(`[ParserRegistry] Registered parser: ${parser.name} for ${mimeTypes.join(', ')} (priority: ${priority})`);
  }

  /**
   * Set the fallback parser for when all registered parsers fail
   */
  setFallbackParser(parser: FileParser): void {
    this.fallbackParser = parser;
    console.log(`[ParserRegistry] Set fallback parser: ${parser.name}`);
  }

  /**
   * Get all parsers registered for a MIME type, sorted by priority
   */
  getParsersForMime(mimeType: string): ParserRegistration[] {
    return this.registrations.get(mimeType) || [];
  }

  /**
   * Check if a parser's circuit breaker is open
   */
  isCircuitOpen(parserName: string): boolean {
    const state = this.circuitBreakers.get(parserName);
    if (!state) return false;

    if (state.state === 'open') {
      const timeSinceFailure = Date.now() - state.lastFailure;
      if (timeSinceFailure > this.globalOptions.circuitBreakerResetMs) {
        state.state = 'half-open';
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record a parser success
   */
  recordSuccess(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    if (state) {
      state.totalCalls++;
      if (state.state === 'half-open') {
        state.state = 'closed';
        state.failures = 0;
        console.log(`[ParserRegistry] Circuit breaker closed for: ${parserName}`);
      } else {
        state.failures = Math.max(0, state.failures - 1);
      }
    }
  }

  /**
   * Record a parser failure
   */
  recordFailure(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    if (state) {
      state.failures++;
      state.totalFailures++;
      state.totalCalls++;
      state.lastFailure = Date.now();

      if (state.failures >= this.globalOptions.circuitBreakerThreshold) {
        state.state = 'open';
        console.warn(`[ParserRegistry] Circuit breaker OPENED for: ${parserName} (${state.failures} consecutive failures)`);
      }
    }
  }

  /**
   * Parse content using registered parsers with fallback
   */
  async parse(
    content: Buffer,
    fileType: DetectedFileType,
    filename?: string
  ): Promise<ParseAttemptResult> {
    const parsers = this.getParsersForMime(fileType.mimeType);
    
    if (parsers.length === 0 && !this.fallbackParser) {
      return {
        success: false,
        error: `No parser registered for MIME type: ${fileType.mimeType}`,
        parserUsed: 'none',
        fallbackUsed: false,
        circuitBreakerTripped: false,
      };
    }

    let lastError: string | undefined;
    let circuitBreakerTripped = false;

    for (const registration of parsers) {
      const { parser, options } = registration;
      const parserOpts = { ...this.globalOptions, ...options };

      if (this.isCircuitOpen(parser.name)) {
        circuitBreakerTripped = true;
        console.log(`[ParserRegistry] Skipping ${parser.name} - circuit breaker open`);
        continue;
      }

      try {
        const result = await parser.parse(content, fileType);
        this.recordSuccess(parser.name);

        return {
          success: true,
          result: {
            ...result,
            metadata: {
              ...result.metadata,
              parser_used: parser.name,
              filename,
            },
          },
          parserUsed: parser.name,
          fallbackUsed: false,
          circuitBreakerTripped,
        };
      } catch (error) {
        this.recordFailure(parser.name);
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(`[ParserRegistry] Parser ${parser.name} failed: ${lastError}`);
      }
    }

    if (this.fallbackParser && this.globalOptions.fallbackEnabled) {
      try {
        console.log(`[ParserRegistry] Using fallback parser for ${fileType.mimeType}`);
        const result = await this.fallbackParser.parse(content, fileType);
        
        return {
          success: true,
          result: {
            ...result,
            metadata: {
              ...result.metadata,
              parser_used: `fallback:${this.fallbackParser.name}`,
              original_mime: fileType.mimeType,
              filename,
            },
            warnings: [
              ...(result.warnings || []),
              `Original parsers failed, used fallback text extraction`,
            ],
          },
          parserUsed: this.fallbackParser.name,
          fallbackUsed: true,
          circuitBreakerTripped,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[ParserRegistry] Fallback parser also failed: ${lastError}`);
      }
    }

    return {
      success: false,
      error: lastError || 'All parsers failed',
      parserUsed: 'none',
      fallbackUsed: false,
      circuitBreakerTripped,
    };
  }

  /**
   * Get circuit breaker status for all parsers
   */
  getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
    const status: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((state, name) => {
      status[name] = { ...state };
    });
    return status;
  }

  /**
   * Reset circuit breaker for a specific parser
   */
  resetCircuitBreaker(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    if (state) {
      state.failures = 0;
      state.state = 'closed';
      console.log(`[ParserRegistry] Circuit breaker manually reset for: ${parserName}`);
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakers.forEach((state, name) => {
      state.failures = 0;
      state.state = 'closed';
    });
    console.log(`[ParserRegistry] All circuit breakers reset`);
  }

  /**
   * Unregister a parser
   */
  unregisterParser(parserName: string): void {
    this.registrations.forEach((registrations, mimeType) => {
      const filtered = registrations.filter(r => r.parser.name !== parserName);
      if (filtered.length > 0) {
        this.registrations.set(mimeType, filtered);
      } else {
        this.registrations.delete(mimeType);
      }
    });
    this.circuitBreakers.delete(parserName);
    console.log(`[ParserRegistry] Unregistered parser: ${parserName}`);
  }

  /**
   * Get all registered MIME types
   */
  getRegisteredMimeTypes(): string[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Get all registered parser names
   */
  getRegisteredParsers(): string[] {
    const names = new Set<string>();
    this.registrations.forEach(regs => {
      regs.forEach(r => names.add(r.parser.name));
    });
    return Array.from(names);
  }
}

export function createParserRegistry(options?: Partial<ParserOptions>): ParserRegistry {
  return new ParserRegistry(options);
}

export const defaultParserRegistry = new ParserRegistry();
