import { describe, expect, it } from "vitest";

import {
  extractBareUrlsFromText,
  filterImportableUrls,
} from "./attachmentIngest";

describe("filterImportableUrls", () => {
  it("keeps direct file URLs importable from bare pasted text", () => {
    const urls = extractBareUrlsFromText(
      "https://example.com/reporte.pdf https://cdn.example.com/imagen.png",
    );

    expect(filterImportableUrls(urls)).toEqual([
      "https://example.com/reporte.pdf",
      "https://cdn.example.com/imagen.png",
    ]);
  });

  it("ignores regular web page URLs so they can stay in the textarea", () => {
    const urls = extractBareUrlsFromText("https://www.google.com/search?q=iliagpt");

    expect(urls).toEqual(["https://www.google.com/search?q=iliagpt"]);
    expect(filterImportableUrls(urls)).toEqual([]);
  });

  it("ignores html pages that are not clearly downloadable files", () => {
    const urls = extractBareUrlsFromText("https://example.com/blog/post.html");

    expect(filterImportableUrls(urls)).toEqual([]);
  });
});
