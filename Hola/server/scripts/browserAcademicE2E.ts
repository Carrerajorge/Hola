import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5050";
const PROMPT = process.env.ACADEMIC_PROMPT ||
  "buscarme 25 articulos cientificos sobre Aplicaciones de inteligencia artificial en salud publica del 2021 al 2025 y colocalo en un excel ordenado por Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus y luego las citas en apa 7ma edicion colocalas en un word";

const outDir = path.join(process.cwd(), "artifacts", "academic_export_browser");
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(300000);

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

const payload = {
  messages: [{ role: "user", content: PROMPT }],
  chatId: `browser-check-${Date.now()}`,
  conversationId: `browser-check-${Date.now()}`,
};

const streamResponse = await page.context().request.post(`${BASE_URL}/api/chat/stream`, {
  data: payload,
  headers: { "content-type": "application/json" },
  timeout: 300000,
});

const sseText = await streamResponse.text();
const events: Array<{ event: string; data: any }> = [];
const artifacts: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];
let gotDone = false;

for (const block of sseText.split(/\n\n+/)) {
  if (!block.trim() || block.startsWith(":")) continue;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) continue;
  const raw = dataLines.join("\n");
  let parsed: any = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {}

  events.push({ event, data: parsed });
  if (event === "artifact" && parsed?.downloadUrl) artifacts.push(parsed);
  if (event === "done") gotDone = true;
}

const sseResult = {
  status: streamResponse.status(),
  gotDone,
  eventCount: events.length,
  eventsTail: events.slice(-30),
  artifacts,
};

await browser.close();

const normalizeUrl = (u: string): string => {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return `${BASE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
};

const downloaded: Array<{ type: string; path: string; size: number }> = [];
for (const art of sseResult.artifacts) {
  const url = normalizeUrl(art.downloadUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Artifact download failed ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const filePath = path.join(outDir, art.filename || `${art.type}_${Date.now()}`);
  await fs.writeFile(filePath, buf);
  downloaded.push({ type: art.type, path: filePath, size: buf.length });
}

const excelFile = downloaded.find((d) => d.type === "excel");
const wordFile = downloaded.find((d) => d.type === "word");

if (!excelFile || !wordFile) {
  throw new Error(`Expected both excel and word artifacts, got: ${JSON.stringify(downloaded)}`);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(excelFile.path);
const ws = wb.getWorksheet("Articles");
if (!ws) throw new Error("Articles sheet missing");

const headers = [
  "Authors",
  "Title",
  "Year",
  "Journal",
  "Abstract",
  "Keywords",
  "Language",
  "Document Type",
  "DOI",
  "City of publication",
  "Country of study",
  "Scopus",
];

const actualHeaders = (ws.getRow(1).values as any[]).slice(1, 13);
const blankCounts = Object.fromEntries(headers.map((h) => [h, 0]));
for (let r = 2; r <= ws.rowCount; r++) {
  for (let c = 1; c <= headers.length; c++) {
    const raw = ws.getCell(r, c).value;
    const value = (typeof raw === "string" ? raw : String(raw ?? "")).trim();
    if (!value) blankCounts[headers[c - 1]]++;
  }
}

const wordRaw = await mammoth.extractRawText({ path: wordFile.path });
const wordText = wordRaw.value || "";

const summary = {
  baseUrl: BASE_URL,
  prompt: PROMPT,
  stream: {
    status: sseResult.status,
    gotDone: sseResult.gotDone,
    eventCount: sseResult.eventCount,
    artifactsCount: sseResult.artifacts.length,
  },
  artifacts: downloaded,
  excel: {
    rows: ws.rowCount - 1,
    headers: actualHeaders,
    headerMatches: JSON.stringify(actualHeaders) === JSON.stringify(headers),
    blankCounts,
  },
  word: {
    hasReferencias: wordText.includes("Referencias"),
    apaYearMentions: (wordText.match(/\(20(21|22|23|24|25)\)/g) || []).length,
    textChars: wordText.length,
  },
  eventsTail: sseResult.eventsTail,
};

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(outDir, `browser_e2e_report_${ts}.json`);
await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");

console.log(JSON.stringify({ ok: true, reportPath, summary }, null, 2));
