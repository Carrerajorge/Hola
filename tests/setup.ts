
// Test environment defaults.
// Prefer real env vars when provided (e.g. CI), otherwise fall back to local docker-compose defaults.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/iliagpt';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'test-client-id';
process.env.MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || 'test-client-secret';
process.env.MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || 'test-tenant-id';

// Use dummy keys if not provided. Tests should mock outbound calls.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';

// Global mocks if needed
import { vi } from 'vitest';

// Example: Mock console.log to reduce noise if desired
// vi.spyOn(console, 'log').mockImplementation(() => {});
