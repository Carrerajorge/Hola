import { describe, it, expect } from "vitest";
import {
  TextStyleSchema,
  TextRunSchema,
  BlockTypeSchema,
  HeadingBlockSchema,
  ParagraphBlockSchema,
  CodeBlockSchema,
  ImageBlockSchema,
  RichTextBlockSchema,
  RichTextDocumentSchema,
  getFontVariantKey,
  mergeStyles,
  normalizeRuns,
} from "@shared/richTextTypes";

describe("TextStyleSchema", () => {
  it("accepts empty object", () => {
    expect(TextStyleSchema.parse({})).toEqual({});
  });
  it("accepts all valid fields", () => {
    const style = {
      bold: true, italic: false, underline: true,
      color: "#ff0000", fontSize: 14, fontFamily: "Arial",
    };
    expect(TextStyleSchema.parse(style)).toMatchObject(style);
  });
  it("rejects invalid types", () => {
    expect(() => TextStyleSchema.parse({ bold: "yes" })).toThrow();
    expect(() => TextStyleSchema.parse({ fontSize: "big" })).toThrow();
  });
});

describe("TextRunSchema", () => {
  it("accepts text without style", () => {
    expect(TextRunSchema.parse({ text: "hello" })).toEqual({ text: "hello" });
  });
  it("accepts text with style", () => {
    const run = { text: "bold", style: { bold: true } };
    expect(TextRunSchema.parse(run)).toMatchObject(run);
  });
  it("rejects missing text", () => {
    expect(() => TextRunSchema.parse({})).toThrow();
  });
});

describe("BlockTypeSchema", () => {
  it("accepts all valid block types", () => {
    const types = ["heading", "paragraph", "bullet-list", "ordered-list",
      "blockquote", "code-block", "horizontal-rule", "table", "image"];
    for (const type of types) {
      expect(BlockTypeSchema.parse(type)).toBe(type);
    }
  });
  it("rejects invalid types", () => {
    expect(() => BlockTypeSchema.parse("div")).toThrow();
  });
});

describe("HeadingBlockSchema", () => {
  it("accepts valid heading", () => {
    const h = { type: "heading", level: 2, runs: [{ text: "Title" }] };
    expect(HeadingBlockSchema.parse(h)).toMatchObject(h);
  });
  it("rejects level 0 or 7", () => {
    expect(() => HeadingBlockSchema.parse({ type: "heading", level: 0, runs: [] })).toThrow();
    expect(() => HeadingBlockSchema.parse({ type: "heading", level: 7, runs: [] })).toThrow();
  });
});

describe("CodeBlockSchema", () => {
  it("accepts code block", () => {
    const block = { type: "code-block", code: "console.log('hi')", language: "js" };
    expect(CodeBlockSchema.parse(block)).toMatchObject(block);
  });
});

describe("ImageBlockSchema", () => {
  it("accepts image block", () => {
    const block = { type: "image", src: "/img.png", alt: "photo" };
    expect(ImageBlockSchema.parse(block)).toMatchObject(block);
  });
  it("rejects missing src", () => {
    expect(() => ImageBlockSchema.parse({ type: "image" })).toThrow();
  });
});

describe("RichTextBlockSchema (discriminated union)", () => {
  it("parses paragraph", () => {
    const block = { type: "paragraph", runs: [{ text: "hi" }] };
    expect(RichTextBlockSchema.parse(block).type).toBe("paragraph");
  });
  it("parses horizontal-rule", () => {
    expect(RichTextBlockSchema.parse({ type: "horizontal-rule" }).type).toBe("horizontal-rule");
  });
  it("rejects unknown type", () => {
    expect(() => RichTextBlockSchema.parse({ type: "unknown" })).toThrow();
  });
});

describe("RichTextDocumentSchema", () => {
  it("accepts minimal document", () => {
    const doc = { blocks: [] };
    expect(RichTextDocumentSchema.parse(doc)).toMatchObject(doc);
  });
  it("accepts document with metadata", () => {
    const doc = {
      blocks: [{ type: "paragraph", runs: [{ text: "hi" }] }],
      metadata: { title: "My Doc", documentType: "report" },
    };
    expect(RichTextDocumentSchema.parse(doc)).toMatchObject(doc);
  });
});

describe("getFontVariantKey", () => {
  it("returns 'regular' for plain style", () => {
    expect(getFontVariantKey({})).toBe("regular");
  });
  it("returns 'bold' for bold", () => {
    expect(getFontVariantKey({ bold: true })).toBe("bold");
  });
  it("returns 'italic' for italic", () => {
    expect(getFontVariantKey({ italic: true })).toBe("italic");
  });
  it("returns 'boldItalic' for both", () => {
    expect(getFontVariantKey({ bold: true, italic: true })).toBe("boldItalic");
  });
});

describe("mergeStyles", () => {
  it("overlay overrides base", () => {
    const result = mergeStyles({ bold: true, color: "red" }, { bold: false, italic: true });
    expect(result.bold).toBe(false);
    expect(result.italic).toBe(true);
    expect(result.color).toBe("red");
  });
  it("preserves base when overlay is empty", () => {
    const result = mergeStyles({ bold: true, fontSize: 14 }, {});
    expect(result.bold).toBe(true);
    expect(result.fontSize).toBe(14);
  });
});

describe("normalizeRuns", () => {
  it("returns empty for empty array", () => {
    expect(normalizeRuns([])).toEqual([]);
  });
  it("merges adjacent runs with same style", () => {
    const runs = [
      { text: "Hello ", style: { bold: true } },
      { text: "World", style: { bold: true } },
    ];
    const normalized = normalizeRuns(runs);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].text).toBe("Hello World");
  });
  it("keeps runs with different styles separate", () => {
    const runs = [
      { text: "bold", style: { bold: true } },
      { text: "italic", style: { italic: true } },
    ];
    expect(normalizeRuns(runs)).toHaveLength(2);
  });
  it("removes empty text runs", () => {
    const runs = [
      { text: "" },
      { text: "hello" },
      { text: "" },
    ];
    const normalized = normalizeRuns(runs);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].text).toBe("hello");
  });
});
