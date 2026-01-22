
// Mock environment variables for testing
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test_db';
process.env.SESSION_SECRET = 'test-secret';
process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-client-secret';
process.env.MICROSOFT_TENANT_ID = 'test-tenant-id';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.NODE_ENV = 'test';

// Global mocks if needed
import { vi } from 'vitest';

// Example: Mock console.log to reduce noise if desired
// vi.spyOn(console, 'log').mockImplementation(() => {});
