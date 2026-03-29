import { describe, expect, it } from "vitest";

import {
  extractBareUrlsFromText,
  filterImportableUrls,
  getPreferredClipboardContent,
  htmlContainsTabularContent,
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

function makeClipboardData(params: {
  text?: string;
  html?: string;
  items?: Array<{ kind?: string; type?: string; file?: File | null }>;
  files?: File[];
}) {
  return {
    getData(type: string) {
      if (type === "text/plain") return params.text || "";
      if (type === "text/html") return params.html || "";
      return "";
    },
    types: [
      ...(params.text ? ["text/plain"] : []),
      ...(params.html ? ["text/html"] : []),
      ...((params.items || []).map((item) => item.type).filter(Boolean) as string[]),
    ],
    items: (params.items || []).map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file || null,
    })),
    files: params.files || [],
  };
}

describe("clipboard preference selection", () => {
  it("prefers plain text over image when clipboard contains real text", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: "image/png",
    });
    const clipboard = makeClipboardData({
      text: "hola mundo",
      items: [{ kind: "file", type: "image/png", file: image }],
      files: [image],
    });

    expect(getPreferredClipboardContent(clipboard)).toEqual({
      kind: "text",
      text: "hola mundo",
    });
  });

  it("keeps table html when clipboard contains spreadsheet-like data", () => {
    const html =
      "<table><tr><th>Nombre</th><th>Edad</th></tr><tr><td>Ana</td><td>30</td></tr></table>";
    const clipboard = makeClipboardData({
      text: "Nombre\tEdad\nAna\t30",
      html,
    });

    expect(htmlContainsTabularContent(html)).toBe(true);
    expect(getPreferredClipboardContent(clipboard)).toEqual({
      kind: "text",
      text: "Nombre\tEdad\nAna\t30",
      html,
    });
  });

  it("falls back to image file when no compatible text payload exists", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "screenshot.png", {
      type: "image/png",
    });
    const clipboard = makeClipboardData({
      items: [{ kind: "file", type: "image/png", file: image }],
      files: [image],
    });

    const preferred = getPreferredClipboardContent(clipboard);
    expect(preferred?.kind).toBe("file");
    expect(preferred && preferred.kind === "file" ? preferred.files[0]?.type : null).toBe(
      "image/png",
    );
  });

  it("treats office html plus plain text as editable text instead of image", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: "image/png",
    });
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><table><tr><td>uno</td></tr></table></body></html>';
    const clipboard = makeClipboardData({
      text: "uno",
      html,
      items: [{ kind: "file", type: "image/png", file: image }],
      files: [image],
    });

    expect(getPreferredClipboardContent(clipboard)).toEqual({
      kind: "text",
      text: "uno",
      html,
    });
  });
});
