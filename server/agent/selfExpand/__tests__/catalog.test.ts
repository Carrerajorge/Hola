import { describe, it, expect } from "vitest";
import { CatalogSchema } from "../types";
import catalogData from "../catalog.json";

describe("selfExpand catalog", () => {
  it("validates against CatalogSchema", () => {
    const parsed = CatalogSchema.parse(catalogData);
    expect(parsed.capabilities.length).toBeGreaterThanOrEqual(10);
  });

  it("every entry has at least one repo", () => {
    const catalog = CatalogSchema.parse(catalogData);
    for (const entry of catalog.capabilities) {
      expect(entry.repos.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all repo git URLs end with .git", () => {
    const catalog = CatalogSchema.parse(catalogData);
    for (const entry of catalog.capabilities) {
      for (const repo of entry.repos) {
        expect(repo.git).toMatch(/\.git$/);
      }
    }
  });

  it("no duplicate capability IDs", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const ids = catalog.capabilities.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has document processing capabilities", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const docCaps = catalog.capabilities.filter((c) =>
      c.tags.some((t) => ["pdf", "docx", "xlsx", "csv"].includes(t))
    );
    expect(docCaps.length).toBeGreaterThanOrEqual(3);
  });

  it("has image processing capabilities", () => {
    const catalog = CatalogSchema.parse(catalogData);
    const imgCaps = catalog.capabilities.filter((c) =>
      c.tags.some((t) => ["image", "resize", "sharp", "vision"].includes(t))
    );
    expect(imgCaps.length).toBeGreaterThanOrEqual(1);
  });
});
