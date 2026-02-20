import { describe, it, expect } from "vitest";
import {
  SheetStatusSchema,
  MetricSchema,
  PreviewMetaSchema,
  PreviewSchema,
  SheetResultSchema,
  ProgressSchema,
  ResultsSchema,
  AnalysisResponseSchema,
  AnalyzeStartResponseSchema,
  validateAnalysisResponse,
  validateAnalyzeStartResponse,
} from "@shared/analysisContract";

describe("SheetStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const status of ["queued", "running", "done", "failed"]) {
      const result = SheetStatusSchema.parse({ sheetName: "Sheet1", status });
      expect(result.status).toBe(status);
    }
  });

  it("rejects invalid status", () => {
    expect(() =>
      SheetStatusSchema.parse({ sheetName: "Sheet1", status: "invalid" })
    ).toThrow();
  });

  it("accepts optional error field", () => {
    const result = SheetStatusSchema.parse({
      sheetName: "Sheet1",
      status: "failed",
      error: "Something went wrong",
    });
    expect(result.error).toBe("Something went wrong");
  });
});

describe("MetricSchema", () => {
  it("accepts valid metric", () => {
    const result = MetricSchema.parse({ label: "Rows", value: "1000" });
    expect(result.label).toBe("Rows");
    expect(result.value).toBe("1000");
  });

  it("rejects missing fields", () => {
    expect(() => MetricSchema.parse({ label: "Test" })).toThrow();
  });
});

describe("PreviewSchema", () => {
  it("accepts valid preview", () => {
    const result = PreviewSchema.parse({
      headers: ["Name", "Age"],
      rows: [["Alice", 30], ["Bob", 25]],
    });
    expect(result.headers).toHaveLength(2);
    expect(result.rows).toHaveLength(2);
  });

  it("accepts preview with meta", () => {
    const result = PreviewSchema.parse({
      headers: ["Col1"],
      rows: [["val"]],
      meta: { totalRows: 100, totalCols: 5, truncated: true },
    });
    expect(result.meta!.truncated).toBe(true);
  });
});

describe("ProgressSchema", () => {
  it("accepts valid progress", () => {
    const result = ProgressSchema.parse({
      currentSheet: 1,
      totalSheets: 3,
      sheets: [
        { sheetName: "Sheet1", status: "done" },
        { sheetName: "Sheet2", status: "running" },
        { sheetName: "Sheet3", status: "queued" },
      ],
    });
    expect(result.totalSheets).toBe(3);
    expect(result.sheets).toHaveLength(3);
  });
});

describe("AnalysisResponseSchema", () => {
  it("accepts complete analysis response", () => {
    const data = {
      analysisId: "abc-123",
      status: "completed",
      progress: {
        currentSheet: 2,
        totalSheets: 2,
        sheets: [
          { sheetName: "Sheet1", status: "done" },
          { sheetName: "Sheet2", status: "done" },
        ],
      },
      results: {
        crossSheetSummary: "All sheets processed",
        sheets: [
          { sheetName: "Sheet1", summary: "OK" },
          { sheetName: "Sheet2", summary: "OK" },
        ],
      },
    };
    const result = AnalysisResponseSchema.parse(data);
    expect(result.status).toBe("completed");
  });

  it("accepts pending status without results", () => {
    const result = AnalysisResponseSchema.parse({
      analysisId: "abc",
      status: "pending",
      progress: { currentSheet: 0, totalSheets: 1, sheets: [] },
    });
    expect(result.results).toBeUndefined();
  });

  it("rejects invalid status", () => {
    expect(() =>
      AnalysisResponseSchema.parse({
        analysisId: "abc",
        status: "unknown",
        progress: { currentSheet: 0, totalSheets: 0, sheets: [] },
      })
    ).toThrow();
  });
});

describe("AnalyzeStartResponseSchema", () => {
  it("accepts valid start response", () => {
    const result = AnalyzeStartResponseSchema.parse({
      analysisId: "abc-123",
      sessionId: "sess-456",
      status: "analyzing",
    });
    expect(result.status).toBe("analyzing");
  });

  it("rejects non-analyzing status", () => {
    expect(() =>
      AnalyzeStartResponseSchema.parse({
        analysisId: "abc",
        sessionId: "sess",
        status: "completed",
      })
    ).toThrow();
  });
});

describe("validateAnalysisResponse", () => {
  it("returns parsed data for valid input", () => {
    const data = {
      analysisId: "test",
      status: "analyzing",
      progress: { currentSheet: 1, totalSheets: 1, sheets: [] },
    };
    const result = validateAnalysisResponse(data);
    expect(result.analysisId).toBe("test");
  });

  it("throws descriptive error for invalid input", () => {
    expect(() => validateAnalysisResponse({ bad: "data" })).toThrow("Invalid analysis response");
  });
});

describe("validateAnalyzeStartResponse", () => {
  it("returns parsed data for valid input", () => {
    const data = { analysisId: "a", sessionId: "b", status: "analyzing" };
    const result = validateAnalyzeStartResponse(data);
    expect(result.analysisId).toBe("a");
  });

  it("throws for invalid input", () => {
    expect(() => validateAnalyzeStartResponse({})).toThrow("Invalid analyze start response");
  });
});
