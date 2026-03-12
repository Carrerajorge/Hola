import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: mockLogger,
}));

import { Logger } from "./logger";

describe("server Logger compatibility wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports instance-scoped debug logging", () => {
    const logger = new Logger("IntentAnalysis");

    logger.debug("Regex classification", { confidence: 0.42 });

    expect(mockLogger.debug).toHaveBeenCalledWith("[IntentAnalysis] Regex classification", {
      confidence: 0.42,
    });
  });

  it("supports instance-scoped warn/error/info logging", () => {
    const logger = new Logger("AnalysisNodes");

    logger.info("start");
    logger.warn("slow");
    logger.error("failed", new Error("boom"));

    expect(mockLogger.info).toHaveBeenCalledWith("[AnalysisNodes] start", undefined);
    expect(mockLogger.warn).toHaveBeenCalledWith("[AnalysisNodes] slow", undefined);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });
});
