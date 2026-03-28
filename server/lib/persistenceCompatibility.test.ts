import { describe, expect, it } from "vitest";

import {
  isOptionalChatRunPersistenceError,
  isOptionalConversationStatePersistenceError,
  summarizePersistenceCompatibilityError,
} from "./persistenceCompatibility";

describe("isOptionalChatRunPersistenceError", () => {
  it("detects missing chat_runs relations wrapped by Drizzle", () => {
    const error = new Error("Failed query");
    (error as any).cause = {
      code: "42P01",
      message: 'relation "chat_runs" does not exist',
    };

    expect(isOptionalChatRunPersistenceError(error)).toBe(true);
  });

  it("ignores unrelated database failures", () => {
    const error = new Error("duplicate key");
    (error as any).cause = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };

    expect(isOptionalChatRunPersistenceError(error)).toBe(false);
  });
});

describe("isOptionalConversationStatePersistenceError", () => {
  it("detects missing conversation state tables", () => {
    const error = new Error("Failed query");
    (error as any).cause = {
      code: "42P01",
      message: 'relation "conversation_states" does not exist',
    };

    expect(isOptionalConversationStatePersistenceError(error)).toBe(true);
  });
});

describe("summarizePersistenceCompatibilityError", () => {
  it("includes the sql code and first message", () => {
    const error = new Error("Failed query");
    (error as any).cause = {
      code: "42703",
      message: 'column "client_request_id" does not exist',
    };

    expect(summarizePersistenceCompatibilityError(error)).toContain("42703");
    expect(summarizePersistenceCompatibilityError(error)).toContain(
      'column "client_request_id" does not exist',
    );
  });
});
