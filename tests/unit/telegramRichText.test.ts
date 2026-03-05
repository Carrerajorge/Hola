import { describe, expect, it } from "vitest";
import {
  polishMathText,
  markdownToTelegramHtml,
  markdownToTelegramHtmlChunks,
  telegramHtmlToPlainText,
} from "../../server/channels/telegram/telegramRichText";

describe("telegramRichText", () => {
  it("renders markdown code blocks and inline code to Telegram HTML", () => {
    const input = "Texto con `codigo`\n\n```ts\nconst x = 1 < 2;\n```";
    const html = markdownToTelegramHtml(input);

    expect(html).toContain("Texto con <code>codigo</code>");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("const x = 1 &lt; 2;");
    expect(html).toContain("</code></pre>");
  });

  it("renders inline and block math in a readable Telegram format", () => {
    const input = "h = $\\frac{SA-2s^2}{4s}$\n\n$$\n\\frac{SA-2s^2}{4s}\n$$";
    const html = markdownToTelegramHtml(input);

    expect(html).toContain("<code>(SA-2s²)/(4s)</code>");
    expect(html).toContain("<b>Formula</b>");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("(SA-2s²)/(4s)");
  });

  it("polishes plain equation text with superscripts outside LaTeX blocks", () => {
    const input = "a) h = (SA + 2s2) / 4";
    const polished = polishMathText(input);
    expect(polished).toContain("2s²");
  });

  it("chunks oversized code blocks into valid Telegram-sized parts", () => {
    const longLine = "x".repeat(4300);
    const input = `\`\`\`txt\n${longLine}\n\`\`\``;
    const chunks = markdownToTelegramHtmlChunks(input, 3900);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.includes("<pre><code>"))).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3900);
      if (chunk.includes("<pre><code>")) {
        expect(chunk.endsWith("</code></pre>")).toBe(true);
      } else {
        expect(chunk).toMatch(/^<b>[A-Z0-9_-]+<\/b>$/);
      }
    }
  });

  it("converts Telegram HTML back to plain text fallback", () => {
    const html = "<b>Titulo</b>\n<pre><code>linea</code></pre>";
    expect(telegramHtmlToPlainText(html)).toContain("Titulo");
    expect(telegramHtmlToPlainText(html)).toContain("linea");
  });
});
