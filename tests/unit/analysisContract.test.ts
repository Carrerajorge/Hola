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

// ---------------------------------------------------------------------------
// SheetStatusSchema
// ---------------------------------------------------------------------------
describe("SheetStatusSchema", () => {
  it("accepts all four valid statuses", () => {
    for (const status of ["queued", "running", "done", "failed"]) {
      const result = SheetStatusSchema.parse({ sheetName: "Sheet1", status });
      expect(result.status).toBe(status);
    }
  });

  it("rejects invalid status value", () => {
    expect(() =>
      SheetStatusSchema.parse({ sheetName: "Sheet1", status: "paused" })
    ).toThrow();
  });

  it("accepts optional error field when status is failed", () => {
    const result = SheetStatusSchema.parse({
      sheetName: "Revenue",
      status: "failed",
      error: "Column mismatch",
    });
    expect(result.error).toBe("Column mismatch");
  });

  it("rejects missing sheetName", () => {
    expect(() => SheetStatusSchema.parse({ status: "queued" })).toThrow();
  });

  it("rejects non-string sheetName", () => {
    expect(() => SheetStatusSchema.parse({ sheetName: 42, status: "done" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MetricSchema
// ---------------------------------------------------------------------------
describe("MetricSchema", () => {
  it("accepts valid metric with string label and string value", () => {
    const result = MetricSchema.parse({ label: "Total Rows", value: "1000" });
    expect(result.label).toBe("Total Rows");
    expect(result.value).toBe("1000");
  });

  it("rejects missing label", () => {
    expect(() => MetricSchema.parse({ value: "123" })).toThrow();
  });

  it("rejects missing value", () => {
    expect(() => MetricSchema.parse({ label: "Test" })).toThrow();
  });

  it("rejects numeric value (must be string)", () => {
    expect(() => MetricSchema.parse({ label: "Count", value: 42 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PreviewMetaSchema
// ---------------------------------------------------------------------------
describe("PreviewMetaSchema", () => {
  it("accepts valid preview meta", () => {
    const result = PreviewMetaSchema.parse({ totalRows: 500, totalCols: 12, truncated: false });
    expect(result.totalRows).toBe(500);
    expect(result.truncated).toBe(false);
  });

  it("rejects missing totalCols", () => {
    expect(() => PreviewMetaSchema.parse({ totalRows: 10, truncated: true })).toThrow();
  });

  it("rejects non-boolean truncated", () => {
    expect(() =>
      PreviewMetaSchema.parse({ totalRows: 10, totalCols: 3, truncated: "yes" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PreviewSchema
// ---------------------------------------------------------------------------
describe("PreviewSchema", () => {
  it("accepts valid preview with headers and rows", () => {
    const result = PreviewSchema.parse({
      headers: ["Name", "Age", "City"],
      rows: [["Alice", 30, "NYC"], ["Bob", 25, "LA"]],
    });
    expect(result.headers).toHaveLength(3);
    expect(result.rows).toHaveLength(2);
  });

  it("accepts preview with optional meta", () => {
    const result = PreviewSchema.parse({
      headers: ["Col1"],
      rows: [["val"]],
      meta: { totalRows: 100, totalCols: 1, truncated: true },
    });
    expect(result.meta).toBeDefined();
    expect(result.meta!.truncated).toBe(true);
  });

  it("accepts empty rows array", () => {
    const result = PreviewSchema.parse({ headers: ["A"], rows: [] });
    expect(result.rows).toHaveLength(0);
  });

  it("rejects missing headers", () => {
    expect(() => PreviewSchema.parse({ rows: [[1, 2]] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SheetResultSchema
// ---------------------------------------------------------------------------
describe("SheetResultSchema", () => {
  it("accepts minimal sheet result with only sheetName", () => {
    const result = SheetResultSchema.parse({ sheetName: "Data" });
    expect(result.sheetName).toBe("Data");
    expect(result.generatedCode).toBeUndefined();
    expect(result.summary).toBeUndefined();
  });

  it("accepts fully populated sheet result", () => {
    const result = SheetResultSchema.parse({
      sheetName: "Sales",
      generatedCode: "console.log('hello')",
      summary: "Sales data from Q1",
      metrics: [{ label: "Total", value: "5000" }],
      preview: { headers: ["Month", "Amount"], rows: [["Jan", 100]] },
      error: undefined,
    });
    expect(result.summary).toBe("Sales data from Q1");
    expect(result.metrics).toHaveLength(1);
    expect(result.preview?.headers).toContain("Month");
  });

  it("accepts sheet result with error and no other optional fields", () => {
    const result = SheetResultSchema.parse({
      sheetName: "Broken",
      error: "Parse failure at row 42",
    });
    expect(result.error).toBe("Parse failure at row 42");
  });

  it("rejects missing sheetName", () => {
    expect(() => SheetResultSchema.parse({ summary: "No name" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProgressSchema
// ---------------------------------------------------------------------------
describe("ProgressSchema", () => {
  it("accepts valid progress with multiple sheets", () => {
    const result = ProgressSchema.parse({
      currentSheet: 2,
      totalSheets: 4,
      sheets: [
        { sheetName: "Sheet1", status: "done" },
        { sheetName: "Sheet2", status: "running" },
        { sheetName: "Sheet3", status: "queued" },
        { sheetName: "Sheet4", status: "queued" },
      ],
    });
    expect(result.totalSheets).toBe(4);
    expect(result.sheets).toHaveLength(4);
    expect(result.currentSheet).toBe(2);
  });

  it("accepts progress with empty sheets array", () => {
    const result = ProgressSchema.parse({
      currentSheet: 0,
      totalSheets: 0,
      sheets: [],
    });
    expect(result.sheets).toHaveLength(0);
  });

  it("rejects missing totalSheets", () => {
    expect(() =>
      ProgressSchema.parse({ currentSheet: 0, sheets: [] })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ResultsSchema
// ---------------------------------------------------------------------------
describe("ResultsSchema", () => {
  it("accepts results with cross-sheet summary and sheets", () => {
    const result = ResultsSchema.parse({
      crossSheetSummary: "All data consistent across sheets",
      sheets: [
        { sheetName: "S1", summary: "OK" },
        { sheetName: "S2", summary: "OK" },
      ],
    });
    expect(result.crossSheetSummary).toBe("All data consistent across sheets");
    expect(result.sheets).toHaveLength(2);
  });

  it("accepts results without crossSheetSummary", () => {
    const result = ResultsSchema.parse({
      sheets: [{ sheetName: "Only" }],
    });
    expect(result.crossSheetSummary).toBeUndefined();
  });

  it("rejects missing sheets array", () => {
    expect(() => ResultsSchema.parse({ crossSheetSummary: "test" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AnalysisResponseSchema
// ---------------------------------------------------------------------------
describe("AnalysisResponseSchema", () => {
  const baseProgress = { currentSheet: 0, totalSheets: 1, sheets: [] };

  it("accepts complete analysis response with results", () => {
    const data = {
      analysisId: "analysis-001",
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
        crossSheetSummary: "All sheets processed successfully",
        sheets: [
          { sheetName: "Sheet1", summary: "Revenue data" },
          { sheetName: "Sheet2", summary: "Cost data" },
        ],
      },
      startedAt: "2024-06-15T10:00:00Z",
      completedAt: "2024-06-15T10:01:30Z",
    };
    const result = AnalysisResponseSchema.parse(data);
    expect(result.status).toBe("completed");
    expect(result.results?.sheets).toHaveLength(2);
    expect(result.completedAt).toBeDefined();
  });

  it("accepts pending status without results", () => {
    const result = AnalysisResponseSchema.parse({
      analysisId: "pending-1",
      status: "pending",
      progress: baseProgress,
    });
    expect(result.results).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("accepts failed status with error string", () => {
    const result = AnalysisResponseSchema.parse({
      analysisId: "fail-1",
      status: "failed",
      progress: baseProgress,
      error: "Out of memory",
    });
    expect(result.error).toBe("Out of memory");
  });

  it("accepts analyzing status", () => {
    const result = AnalysisResponseSchema.parse({
      analysisId: "active-1",
      status: "analyzing",
      progress: { currentSheet: 1, totalSheets: 3, sheets: [{ sheetName: "S1", status: "running" }] },
    });
    expect(result.status).toBe("analyzing");
  });

  it("rejects invalid status value", () => {
    expect(() =>
      AnalysisResponseSchema.parse({
        analysisId: "x",
        status: "cancelled",
        progress: baseProgress,
      })
    ).toThrow();
  });

  it("rejects missing analysisId", () => {
    expect(() =>
      AnalysisResponseSchema.parse({ status: "pending", progress: baseProgress })
    ).toThrow();
  });

  it("rejects missing progress", () => {
    expect(() =>
      AnalysisResponseSchema.parse({ analysisId: "x", status: "pending" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AnalyzeStartResponseSchema
// ---------------------------------------------------------------------------
describe("AnalyzeStartResponseSchema", () => {
  it("accepts valid start response with literal 'analyzing' status", () => {
    const result = AnalyzeStartResponseSchema.parse({
      analysisId: "start-001",
      sessionId: "sess-abc",
      status: "analyzing",
    });
    expect(result.status).toBe("analyzing");
    expect(result.analysisId).toBe("start-001");
    expect(result.sessionId).toBe("sess-abc");
  });

  it("rejects non-'analyzing' status (literal type)", () => {
    expect(() =>
      AnalyzeStartResponseSchema.parse({
        analysisId: "x",
        sessionId: "y",
        status: "completed",
      })
    ).toThrow();
  });

  it("rejects status 'pending'", () => {
    expect(() =>
      AnalyzeStartResponseSchema.parse({
        analysisId: "x",
        sessionId: "y",
        status: "pending",
      })
    ).toThrow();
  });

  it("rejects missing sessionId", () => {
    expect(() =>
      AnalyzeStartResponseSchema.parse({ analysisId: "x", status: "analyzing" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateAnalysisResponse
// ---------------------------------------------------------------------------
describe("validateAnalysisResponse", () => {
  it("returns parsed data for valid input", () => {
    const data = {
      analysisId: "val-test",
      status: "analyzing",
      progress: { currentSheet: 1, totalSheets: 1, sheets: [] },
    };
    const result = validateAnalysisResponse(data);
    expect(result.analysisId).toBe("val-test");
    expect(result.status).toBe("analyzing");
  });

  it("throws descriptive error for completely invalid input", () => {
    expect(() => validateAnalysisResponse({ bad: "data" })).toThrow(
      "Invalid analysis response"
    );
  });

  it("throws error mentioning the invalid field path", () => {
    try {
      validateAnalysisResponse({ analysisId: 123, status: "pending", progress: {} });
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Invalid analysis response shape");
    }
  });

  it("returns correct data when all optional fields are present", () => {
    const data = {
      analysisId: "full",
      status: "completed",
      progress: { currentSheet: 1, totalSheets: 1, sheets: [{ sheetName: "S", status: "done" }] },
      results: { sheets: [{ sheetName: "S", summary: "Good" }] },
      error: undefined,
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:01:00Z",
    };
    const result = validateAnalysisResponse(data);
    expect(result.completedAt).toBe("2024-01-01T00:01:00Z");
  });
});

// ---------------------------------------------------------------------------
// validateAnalyzeStartResponse
// ---------------------------------------------------------------------------
describe("validateAnalyzeStartResponse", () => {
  it("returns parsed data for valid input", () => {
    const data = { analysisId: "a1", sessionId: "s1", status: "analyzing" };
    const result = validateAnalyzeStartResponse(data);
    expect(result.analysisId).toBe("a1");
    expect(result.sessionId).toBe("s1");
  });

  it("throws descriptive error for empty object", () => {
    expect(() => validateAnalyzeStartResponse({})).toThrow(
      "Invalid analyze start response"
    );
  });

  it("throws when status is wrong literal", () => {
    expect(() =>
      validateAnalyzeStartResponse({ analysisId: "a", sessionId: "b", status: "done" })
    ).toThrow("Invalid analyze start response");
  });

  it("throws for null input", () => {
    expect(() => validateAnalyzeStartResponse(null)).toThrow();
  });

  it("throws for undefined input", () => {
    expect(() => validateAnalyzeStartResponse(undefined)).toThrow();
  });
});
