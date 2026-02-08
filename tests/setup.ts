
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

// Supertest binds ephemeral servers to 0.0.0.0 by default when passed an Express app.
// Some sandboxed environments disallow binding to all interfaces. Patch Supertest to
// bind to 127.0.0.1 for portability across dev/CI/sandboxes.
import { createRequire } from "node:module";
import { Server as HttpsServer } from "node:https";

try {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Test = require("supertest/lib/test");
  if (Test?.prototype?.serverAddress) {
    Test.prototype.serverAddress = function serverAddress(app: any, path: string) {
      const addr = app.address?.();
      if (!addr) this._server = app.listen(0, "127.0.0.1");
      const port = app.address().port;
      const protocol = app instanceof HttpsServer ? "https" : "http";
      return `${protocol}://127.0.0.1:${port}${path}`;
    };
  }
} catch {
  // Best-effort patch; if supertest internals change, tests can still opt into
  // manual server binding via tests/helpers/httpTestClient.ts.
}
