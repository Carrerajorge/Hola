import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  excelSpecSchema,
  docSpecSchema,
  cvSpecSchema,
  reportSpecSchema,
  letterSpecSchema,
  chartSpecSchema,
  tableSpecSchema,
} from "@shared/documentSpecs";

describe("documentSpecs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- excelSpecSchema ----------

  describe("excelSpecSchema", () => {
    it("accepts valid minimal Excel spec", () => {
      const data = {
        sheets: [{ name: "Sheet1" }],
      };
      const result = excelSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects empty sheets array", () => {
      const result = excelSpecSchema.safeParse({ sheets: [] });
      expect(result.success).toBe(false);
    });

    it("accepts Excel spec with tables and charts", () => {
      const data = {
        workbook_title: "Budget",
        sheets: [
          {
            name: "Revenue",
            tables: [
              {
                anchor: "A1",
                headers: ["Quarter", "Amount"],
                rows: [["Q1", 1000]],
              },
            ],
            charts: [
              {
                type: "bar",
                title: "Revenue Chart",
                categories_range: "A2:A5",
                values_range: "B2:B5",
              },
            ],
          },
        ],
      };
      const result = excelSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects sheet with name longer than 31 chars", () => {
      const result = excelSpecSchema.safeParse({
        sheets: [{ name: "A".repeat(32) }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ---------- docSpecSchema ----------

  describe("docSpecSchema", () => {
    it("accepts valid minimal Doc spec", () => {
      const result = docSpecSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts Doc spec with various block types", () => {
      const data = {
        title: "My Document",
        blocks: [
          { type: "title", text: "Introduction" },
          { type: "heading", text: "Section 1", level: 2 },
          { type: "paragraph", text: "Some text here." },
          { type: "bullets", items: ["Item 1", "Item 2"] },
        ],
      };
      const result = docSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects block with unknown type", () => {
      const data = {
        blocks: [{ type: "unknown_type", text: "bad" }],
      };
      const result = docSpecSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("applies default styleset to modern", () => {
      const result = docSpecSchema.parse({});
      expect(result.styleset).toBe("modern");
    });
  });

  // ---------- chartSpecSchema ----------

  describe("chartSpecSchema", () => {
    it("accepts bar chart type", () => {
      const result = chartSpecSchema.safeParse({
        type: "bar",
        categories_range: "A1:A10",
        values_range: "B1:B10",
      });
      expect(result.success).toBe(true);
    });

    it("accepts line chart type", () => {
      const result = chartSpecSchema.safeParse({
        type: "line",
        categories_range: "A1:A5",
        values_range: "B1:B5",
      });
      expect(result.success).toBe(true);
    });

    it("accepts pie chart type", () => {
      const result = chartSpecSchema.safeParse({
        type: "pie",
        categories_range: "A1:A3",
        values_range: "B1:B3",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid chart type", () => {
      const result = chartSpecSchema.safeParse({
        type: "scatter",
        categories_range: "A1:A5",
        values_range: "B1:B5",
      });
      expect(result.success).toBe(false);
    });
  });

  // ---------- tableSpecSchema ----------

  describe("tableSpecSchema", () => {
    it("accepts valid table spec", () => {
      const result = tableSpecSchema.safeParse({
        anchor: "A1",
        headers: ["Name", "Age"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects table with empty headers", () => {
      const result = tableSpecSchema.safeParse({
        anchor: "A1",
        headers: [],
      });
      expect(result.success).toBe(false);
    });
  });

  // ---------- cvSpecSchema ----------

  describe("cvSpecSchema", () => {
    it("accepts CV with required header", () => {
      const data = {
        header: {
          name: "John Doe",
          phone: "+1234567890",
          email: "john@example.com",
          address: "New York, USA",
        },
      };
      const result = cvSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects CV without header", () => {
      const result = cvSpecSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects CV with invalid email in header", () => {
      const result = cvSpecSchema.safeParse({
        header: {
          name: "John",
          phone: "123",
          email: "not-an-email",
          address: "NYC",
        },
      });
      expect(result.success).toBe(false);
    });

    it("applies default template_style to modern", () => {
      const parsed = cvSpecSchema.parse({
        header: {
          name: "Jane",
          phone: "555-0100",
          email: "jane@example.com",
          address: "London",
        },
      });
      expect(parsed.template_style).toBe("modern");
    });
  });

  // ---------- reportSpecSchema ----------

  describe("reportSpecSchema", () => {
    it("accepts report with minimal header", () => {
      const result = reportSpecSchema.safeParse({
        header: { title: "Quarterly Report" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects report without header", () => {
      const result = reportSpecSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts report with sections", () => {
      const data = {
        header: { title: "Annual Review" },
        sections: [
          {
            title: "Introduction",
            content: [{ type: "text", content: "Overview of the year." }],
          },
        ],
      };
      const result = reportSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("applies default template_style to corporate", () => {
      const parsed = reportSpecSchema.parse({
        header: { title: "Test" },
      });
      expect(parsed.template_style).toBe("corporate");
    });
  });

  // ---------- letterSpecSchema ----------

  describe("letterSpecSchema", () => {
    it("accepts valid letter spec", () => {
      const data = {
        sender: { name: "Alice", address: "123 Main St" },
        recipient: { name: "Bob", address: "456 Oak Ave" },
        date: "2024-01-15",
        body_paragraphs: ["Thank you for your inquiry."],
        signature_name: "Alice Smith",
      };
      const result = letterSpecSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects letter without body_paragraphs", () => {
      const data = {
        sender: { name: "Alice", address: "123 Main St" },
        recipient: { name: "Bob", address: "456 Oak Ave" },
        date: "2024-01-15",
        body_paragraphs: [],
        signature_name: "Alice",
      };
      const result = letterSpecSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("applies default closing to Sincerely", () => {
      const parsed = letterSpecSchema.parse({
        sender: { name: "A", address: "addr" },
        recipient: { name: "B", address: "addr" },
        date: "2024-01-01",
        body_paragraphs: ["Hello."],
        signature_name: "A",
      });
      expect(parsed.closing).toBe("Sincerely");
    });
  });
});
