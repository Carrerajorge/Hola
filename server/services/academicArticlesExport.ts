import {
  unifiedArticleSearch,
  type UnifiedArticle,
  type SearchOptions as UnifiedSearchOptions,
} from "../agent/superAgent/unifiedArticleSearch";
import { searchCrossRef, verifyDOI, type VerifyDOIResult } from "../agent/superAgent/crossrefClient";
import { lookupOpenAlexWorkByDoi, type AcademicCandidate } from "../agent/superAgent/openAlexClient";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

export type AcademicRegion = {
  latam: boolean;
  spain: boolean;
};

export interface AcademicArticlesExportPlan {
  topicQuery: string;
  requestedCount: number;
  yearFrom?: number;
  yearTo?: number;
  region: AcademicRegion;
  // Scopus-only filter: affiliation countries list
  affilCountries?: string[];
  sources: NonNullable<UnifiedSearchOptions["sources"]>;
}

export interface AcademicArticlesExportResult {
  plan: AcademicArticlesExportPlan;
  articles: UnifiedArticle[];
  excelBuffer: Buffer;
  wordBuffer: Buffer;
  stats: {
    totalReturned: number;
    totalRequested: number;
    bySource: Record<string, number>;
    coverage: Record<
      "doi" | "abstract" | "keywords" | "journal" | "city" | "country" | "language" | "documentType",
      { present: number; missing: number }
    >;
    notes: string[];
  };
}

const LATAM_COUNTRIES_EN = [
  "Argentina",
  "Bolivia",
  "Brazil",
  "Chile",
  "Colombia",
  "Costa Rica",
  "Cuba",
  "Dominican Republic",
  "Ecuador",
  "El Salvador",
  "Guatemala",
  "Honduras",
  "Mexico",
  "Nicaragua",
  "Panama",
  "Paraguay",
  "Peru",
  "Puerto Rico",
  "Uruguay",
  "Venezuela",
];

function detectRegion(prompt: string): AcademicRegion {
  const p = prompt.toLowerCase();
  const latam = /\b(latinoam[eé]rica|america\s+latina|am[eé]rica\s+latina|latam)\b/i.test(p);
  const spain = /\b(espa[ñn]a)\b/i.test(p);
  return { latam, spain };
}

function extractCount(prompt: string): number {
  // "buscarme 100 articulos", "buscame 50 papers", etc.
  const m = prompt.match(/\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\s+(\d{1,3})\s+(?:art[ií]culos?|papers?|estudios?)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > 0) return Math.min(100, n);
  }
  return 50;
}

function extractYearRange(prompt: string): { yearFrom?: number; yearTo?: number } {
  const m = prompt.match(/\b(19\d{2}|20\d{2})\s*(?:al|-|hasta|to)\s*(19\d{2}|20\d{2})\b/i);
  if (!m) return {};
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return {};
  return { yearFrom: Math.min(a, b), yearTo: Math.max(a, b) };
}

function extractTopicQuery(prompt: string): string {
  // Try to capture: "... sobre <TOPIC> del 2021 al 2025 ..." or before export instructions.
  const m = prompt.match(
    /(?:\bsobre\b|\bacerca\s+de\b|\brelacionad[ao]\s+con\b)\s+(.+?)(?=\s+(?:del?|entre)?\s*(?:19\d{2}|20\d{2})\s*(?:al|-|hasta|to)\s*(?:19\d{2}|20\d{2})\b|\s+y\s+(?:coloca|colocalo|luego)\b|\s+en\s+un\s+excel\b|\s+en\s+excel\b|\s+en\s+un\s+word\b|\s+en\s+word\b|$)/i
  );
  if (m?.[1]?.trim()) return m[1].trim();

  // Fallback: strip common "find me N papers" prefix and trailing export instructions
  let t = prompt.trim();
  t = t.replace(/\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\s+\d{1,3}\s+(?:art[ií]culos?|papers?|estudios?)\b/i, "").trim();
  t = t.replace(/\b(en|en\s+un)\s+(excel|xlsx|word|docx)\b[\s\S]*$/i, "").trim();
  return t || prompt.trim();
}

function detectSourceFlags(prompt: string): {
  wantsWos: boolean;
  wantsDuckDuckGo: boolean;
  freeOnly: boolean;
  noScopus: boolean;
  noWos: boolean;
  noDuckDuckGo: boolean;
} {
  const p = prompt.toLowerCase();

  const wantsWos = /\b(wos|web\s*of\s*science|clarivate)\b/i.test(p);
  const wantsDuckDuckGo = /\b(duckduckgo|duck\s*duck\s*go|ddg)\b/i.test(p);

  const noScopus = /\b(?:sin|no)\s+scopus\b/i.test(p);
  const noWos = /\b(?:sin|no)\s+(?:wos|web\s*of\s*science)\b/i.test(p);
  const noDuckDuckGo = /\b(?:sin|no)\s+(?:duckduckgo|duck\s*duck\s*go|ddg)\b/i.test(p);

  // If the user insists on "only free" sources, skip paid/closed APIs (Scopus/WoS).
  // Note: "gratis" is ambiguous; treat it as strict only when phrased explicitly.
  const freeOnly =
    /\b(100%\s*gratis|solo\s+gratis|totalmente\s+gratis|sin\s+costo|gratuito\s+para\s+siempre)\b/i.test(p) ||
    (/\bgratis\b/i.test(p) && (noScopus || noWos));

  return {
    wantsWos,
    wantsDuckDuckGo,
    freeOnly,
    noScopus,
    noWos,
    noDuckDuckGo,
  };
}

function normalizeCountry(country: string): string {
  return country.trim().toLowerCase();
}

function buildAffilCountries(region: AcademicRegion): string[] | undefined {
  const list: string[] = [];
  if (region.latam) list.push(...LATAM_COUNTRIES_EN);
  if (region.spain) list.push("Spain");
  const unique = Array.from(new Set(list.map(c => c.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

export function planAcademicArticlesExport(prompt: string): AcademicArticlesExportPlan {
  const region = detectRegion(prompt);
  const requestedCount = extractCount(prompt);
  const { yearFrom, yearTo } = extractYearRange(prompt);
  const topicQuery = extractTopicQuery(prompt);
  const flags = detectSourceFlags(prompt);

  // For region-restricted requests, avoid PubMed because we can't reliably enforce affiliation country.
  let sources: AcademicArticlesExportPlan["sources"] =
    region.latam || region.spain
      ? ["scopus", "openalex", "scielo", "redalyc"]
      : ["scopus", "openalex", "pubmed", "scielo", "redalyc"];

  if (flags.freeOnly) {
    sources = region.latam || region.spain
      ? ["openalex", "scielo", "redalyc", "duckduckgo"]
      : ["openalex", "pubmed", "scielo", "redalyc", "duckduckgo"];
  }

  if (flags.wantsWos) sources = [...sources, "wos"];
  if (flags.wantsDuckDuckGo) sources = [...sources, "duckduckgo"];

  if (flags.noScopus) sources = sources.filter((s) => s !== "scopus");
  if (flags.noWos) sources = sources.filter((s) => s !== "wos");
  if (flags.noDuckDuckGo) sources = sources.filter((s) => s !== "duckduckgo");

  sources = Array.from(new Set(sources));

  return {
    topicQuery,
    requestedCount,
    yearFrom,
    yearTo,
    region,
    affilCountries: buildAffilCountries(region),
    sources,
  };
}

function isAllowedByRegion(article: UnifiedArticle, plan: AcademicArticlesExportPlan, allowedCountries: Set<string> | null): boolean {
  if (!allowedCountries) return true;

  const country = (article.country || "").trim();
  const normalized = country ? normalizeCountry(country) : "";

  // Scopus: enforce strict affiliation-country matching when available.
  if (article.source === "scopus") {
    return normalized.length > 0 && allowedCountries.has(normalized);
  }

  // OpenAlex: if we asked OpenAlex with a country filter, we can trust it even if our country extraction fails.
  if (article.source === "openalex") {
    if (normalized.length > 0 && normalized !== "unknown" && normalized !== "n.d.") {
      return allowedCountries.has(normalized);
    }
    return !!plan.affilCountries;
  }

  // SciELO / Redalyc: many records don't expose a clean country. Treat "LatAm" as allowed only if requested.
  if (normalized === "latam") return plan.region.latam;

  // If we have a real country, enforce it.
  if (normalized.length > 0 && normalized !== "n.d.") return allowedCountries.has(normalized);

  // Unknown country: allow only for LatAm requests and only for region-focused sources.
  if (article.source === "scielo" || article.source === "redalyc") return plan.region.latam;

  // Otherwise drop to avoid leaking global content into a strict region filter.
  return false;
}

function formatAuthorAPA(author: string): string {
  const a = (author || "").trim();
  if (!a) return "";

  const commaParts = a.split(",").map(p => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const lastName = commaParts[0];
    const given = commaParts.slice(1).join(" ");
    const initials = given
      .split(/\s+/)
      .filter(Boolean)
      .map(n => (n.endsWith(".") ? n.charAt(0).toUpperCase() + "." : n.charAt(0).toUpperCase() + "."))
      .join(" ");
    return `${lastName}, ${initials}`.trim();
  }

  const spaceParts = a.split(/\s+/).map(p => p.trim()).filter(Boolean);
  if (spaceParts.length >= 2) {
    const lastName = spaceParts[spaceParts.length - 1];
    const given = spaceParts.slice(0, -1);
    const initials = given.map(n => n.charAt(0).toUpperCase() + ".").join(" ");
    return `${lastName}, ${initials}`.trim();
  }

  return a;
}

function formatAuthorsAPA7(authors: string[]): string {
  const list = (authors || []).map(formatAuthorAPA).filter(Boolean);
  if (list.length === 0) return "Author unknown";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  if (list.length <= 20) return `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
  return `${list.slice(0, 19).join(", ")}, ... ${list[list.length - 1]}`;
}

const APA_FONT = "Times New Roman";
const APA_SIZE = 24; // 12pt in docx half-points

function normalizeWhitespace(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function ensureEndsWithPeriod(text: string): string {
  const t = normalizeWhitespace(text);
  if (!t) return "";
  return t.endsWith(".") ? t : `${t}.`;
}

function buildApaCitationRuns(article: UnifiedArticle): TextRun[] {
  const authors = formatAuthorsAPA7(article.authors || []);
  const year = normalizeWhitespace(article.year || "n.d.") || "n.d.";
  const title = ensureEndsWithPeriod(article.title || "Untitled");

  const journal = normalizeWhitespace(article.journal || "");
  const volume = normalizeWhitespace(article.volume || "");
  const issue = normalizeWhitespace(article.issue || "");
  const pages = normalizeWhitespace(article.pages || "");

  const doi = normalizeWhitespace(article.doi || "");
  const doiUrl = doi ? `https://doi.org/${doi}` : "";

  const runs: TextRun[] = [
    new TextRun({ text: `${authors} (${year}). ${title} `, font: APA_FONT, size: APA_SIZE }),
  ];

  if (!journal) {
    if (doiUrl) runs.push(new TextRun({ text: doiUrl, font: APA_FONT, size: APA_SIZE }));
    return runs;
  }

  // Journal title (italic)
  runs.push(new TextRun({ text: journal, italics: true, font: APA_FONT, size: APA_SIZE }));

  // APA: Journal Title, 12(3), 45-67. https://doi.org/...
  if (volume) {
    runs.push(new TextRun({ text: ", ", font: APA_FONT, size: APA_SIZE }));
    runs.push(new TextRun({ text: volume, italics: true, font: APA_FONT, size: APA_SIZE }));
    if (issue) runs.push(new TextRun({ text: `(${issue})`, font: APA_FONT, size: APA_SIZE }));
    if (pages) runs.push(new TextRun({ text: `, ${pages}`, font: APA_FONT, size: APA_SIZE }));
    runs.push(new TextRun({ text: ".", font: APA_FONT, size: APA_SIZE }));
  } else if (pages) {
    runs.push(new TextRun({ text: `, ${pages}.`, font: APA_FONT, size: APA_SIZE }));
  } else {
    runs.push(new TextRun({ text: ".", font: APA_FONT, size: APA_SIZE }));
  }

  if (doiUrl) runs.push(new TextRun({ text: ` ${doiUrl}`, font: APA_FONT, size: APA_SIZE }));

  return runs;
}

async function generateApaReferencesDocx(topic: string, articles: UnifiedArticle[]): Promise<Buffer> {
  const sorted = [...articles].sort((a, b) => {
    const aKey = (a.authors?.[0] || "").toLowerCase();
    const bKey = (b.authors?.[0] || "").toLowerCase();
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    return at.localeCompare(bt);
  });

  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        new TextRun({ text: "Referencias", bold: true, font: "Times New Roman", size: 32 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 500 },
      children: [
        new TextRun({ text: "(Formato APA 7ma Edicion)", italics: true, font: "Times New Roman", size: 24 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Tema: ${topic}`, font: "Times New Roman", size: 22, italics: true }),
      ],
    }),
  ];

  for (const a of sorted) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        indent: { hanging: 720, left: 720 },
        children: buildApaCitationRuns(a),
      })
    );
  }

  const doc = new Document({
    creator: "IliaGPT",
    title: `Referencias APA7 - ${topic}`,
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBuffer(doc);
}

function normalizeLanguageLabel(lang: string | undefined): string {
  const l = (lang || "").trim();
  if (!l) return "n.d.";
  const lower = l.toLowerCase();

  const map: Record<string, string> = {
    es: "Spanish",
    spa: "Spanish",
    spanish: "Spanish",
    español: "Spanish",
    espanol: "Spanish",
    pt: "Portuguese",
    por: "Portuguese",
    portuguese: "Portuguese",
    português: "Portuguese",
    portugues: "Portuguese",
    en: "English",
    eng: "English",
    english: "English",
    fr: "French",
    fra: "French",
    french: "French",
  };

  return map[lower] || l;
}

async function generateAcademicArticlesExcel(articles: UnifiedArticle[]): Promise<Buffer> {
  // Columns: Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus
  const sorted = [...articles].sort((a, b) => {
    const aKey = (a.authors?.[0] || "").toLowerCase();
    const bKey = (b.authors?.[0] || "").toLowerCase();
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    if (at !== bt) return at.localeCompare(bt);
    return (b.year || "").localeCompare(a.year || "");
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Articles", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Authors", key: "authors", width: 40 },
    { header: "Title", key: "title", width: 60 },
    { header: "Year", key: "year", width: 8 },
    { header: "Journal", key: "journal", width: 30 },
    { header: "Abstract", key: "abstract", width: 80 },
    { header: "Keywords", key: "keywords", width: 35 },
    { header: "Language", key: "language", width: 12 },
    { header: "Document Type", key: "documentType", width: 18 },
    { header: "DOI", key: "doi", width: 28 },
    { header: "City of publication", key: "city", width: 22 },
    { header: "Country of study", key: "country", width: 22 },
    { header: "Scopus", key: "scopus", width: 10 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A365D" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 22;

  for (const a of sorted) {
    sheet.addRow({
      authors: a.authors?.join(", ") || "n.d.",
      title: a.title || "n.d.",
      year: a.year || "n.d.",
      journal: a.journal || "n.d.",
      abstract: a.abstract || "n.d.",
      keywords: (a.keywords || []).join(", ") || "n.d.",
      language: normalizeLanguageLabel(a.language),
      documentType: a.documentType || "Article",
      doi: a.doi || "",
      city: a.city || "n.d.",
      country: a.country || "n.d.",
      scopus: a.source === "scopus" ? "Yes" : "No",
    });
  }

  // Style rows (wrap long text)
  for (let rowIdx = 2; rowIdx <= sheet.rowCount; rowIdx++) {
    const row = sheet.getRow(rowIdx);
    row.alignment = { vertical: "top", wrapText: true };
  }

  // Auto-filter
  const lastColLetter = sheet.getColumn(sheet.columnCount).letter;
  sheet.autoFilter = {
    from: "A1",
    to: `${lastColLetter}1`,
  };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function exportAcademicArticlesFromPrompt(prompt: string): Promise<AcademicArticlesExportResult> {
  const plan = planAcademicArticlesExport(prompt);
  const allowedCountries = plan.affilCountries ? new Set(plan.affilCountries.map(normalizeCountry)) : null;

  const notes: string[] = [];

  const sources = plan.sources.filter((s) => {
    if (s === "scopus") {
      const ok = unifiedArticleSearch.isScopusConfigured();
      if (!ok) notes.push("Scopus no esta configurado (faltante SCOPUS_API_KEY).");
      return ok;
    }
    if (s === "wos") {
      const ok = typeof (unifiedArticleSearch as any).isWosConfigured === "function"
        ? (unifiedArticleSearch as any).isWosConfigured()
        : false;
      if (!ok) notes.push("Web of Science no esta configurado (faltante WOS_API_KEY).");
      return ok;
    }
    if (s === "pubmed") return unifiedArticleSearch.isPubMedConfigured();
    if (s === "scielo") return unifiedArticleSearch.isSciELOConfigured();
    if (s === "redalyc") return unifiedArticleSearch.isRedalycConfigured();
    if (s === "openalex") return true;
    if (s === "duckduckgo") return true;
    return true;
  });

  const internalMaxResults = Math.min(1200, Math.max(400, plan.requestedCount * 8));
  const internalMaxPerSource = Math.min(800, Math.max(120, plan.requestedCount * 4));

  function normalizeTextKey(text: string): string {
    return (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeTitleKey(title: string): string {
    return normalizeTextKey(title).substring(0, 140);
  }

  function normalizeDoi(doi: string | undefined): string | undefined {
    const d = (doi || "").trim();
    if (!d) return undefined;
    return d
      .replace(/^https?:\/\/doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[\s]+/g, "")
      .replace(/[),.;]+$/g, "")
      .trim();
  }

  function isMissingScalar(value: string | undefined): boolean {
    const v = (value || "").trim().toLowerCase();
    return !v || v === "n.d." || v === "unknown" || v === "latam";
  }

  function hasMeaningfulAbstract(value: string | undefined): boolean {
    const v = (value || "").trim();
    if (!v) return false;
    if (v.toLowerCase() === "n.d.") return false;
    return v.length >= 60;
  }

  function completenessScore(a: UnifiedArticle): number {
    let score = 0;
    if (!isMissingScalar(a.year)) score += 1;
    if (!isMissingScalar(a.journal)) score += 1;
    if (hasMeaningfulAbstract(a.abstract)) score += 2;
    if ((a.keywords || []).length > 0) score += 2;
    if (!isMissingScalar(a.language)) score += 1;
    if (!isMissingScalar(a.documentType)) score += 1;
    if (!isMissingScalar(a.doi)) score += 2;
    if (!isMissingScalar(a.country)) score += 2;
    if (!isMissingScalar(a.city)) score += 1;
    return score;
  }

  function chooseBetter(existing: UnifiedArticle, incoming: UnifiedArticle): UnifiedArticle {
    const aScore = completenessScore(existing);
    const bScore = completenessScore(incoming);
    if (bScore !== aScore) return bScore > aScore ? incoming : existing;

    const aAbs = (existing.abstract || "").length;
    const bAbs = (incoming.abstract || "").length;
    if (bAbs !== aAbs) return bAbs > aAbs ? incoming : existing;

    const aKw = (existing.keywords || []).length;
    const bKw = (incoming.keywords || []).length;
    if (bKw !== aKw) return bKw > aKw ? incoming : existing;

    // Prefer Scopus if tie.
    const rank: Record<string, number> = { scopus: 5, wos: 4, openalex: 3, scielo: 2, redalyc: 2, duckduckgo: 1, pubmed: 1 };
    const ar = rank[existing.source] || 0;
    const br = rank[incoming.source] || 0;
    if (br !== ar) return br > ar ? incoming : existing;

    return existing;
  }

  function dedupeUnifiedArticles(articles: UnifiedArticle[]): UnifiedArticle[] {
    const map = new Map<string, UnifiedArticle>();
    for (const a of articles) {
      const doi = normalizeDoi(a.doi);
      const key = doi ? `doi:${doi.toLowerCase()}` : `title:${normalizeTitleKey(a.title)}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...a, doi: doi || a.doi });
        continue;
      }
      map.set(key, chooseBetter(prev, { ...a, doi: doi || a.doi }));
    }
    return Array.from(map.values());
  }

  function buildQueryVariants(topic: string): string[] {
    const base = (topic || "").trim();
    if (!base) return [];

    const variants: string[] = [base];

    const ascii = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (ascii !== base) variants.push(ascii);

    // Lightweight domain translation (helps OpenAlex recall).
    let en = ascii;
    const replacements: Array<[RegExp, string]> = [
      [/\beconomia\s+circular\b/gi, "circular economy"],
      [/\beconom[ií]a\s+circular\b/gi, "circular economy"],
      [/\bcadena\s+de\s+suministro\b/gi, "supply chain"],
      [/\bempresa(?:s)?\s+exportadora(?:s)?\b/gi, "exporting company"],
      [/\bexportadora(?:s)?\b/gi, "exporter"],
      [/\bimpacto\b/gi, "impact"],
      [/\blog[ií]stica\b/gi, "logistics"],
      [/\bsostenibilidad\b/gi, "sustainability"],
    ];
    for (const [re, rep] of replacements) {
      en = en.replace(re, rep);
    }
    if (en !== base && en !== ascii) variants.push(en);

    // Core terms only
    variants.push("circular economy supply chain");
    variants.push("circular economy supply chain exporter");

    return Array.from(new Set(variants.map(v => v.trim()).filter(Boolean)));
  }

  function tokenSet(title: string): Set<string> {
    return new Set(
      normalizeTextKey(title)
        .split(" ")
        .filter(Boolean)
        .filter((t) => t.length >= 3 && !["the", "and", "for", "with", "from", "sobre", "para", "del", "una", "uno", "los", "las", "que", "de", "en"].includes(t))
    );
  }

  function titleSimilarity(a: string, b: string): number {
    const A = tokenSet(a);
    const B = tokenSet(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function mergeKeywords(...lists: Array<string[] | undefined>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const l of lists) {
      for (const k of l || []) {
        const kw = (k || "").trim();
        if (!kw) continue;
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(kw);
      }
    }
    return out;
  }

  function mergeAuthors(primary: string[], secondary: string[] | undefined): string[] {
    if (primary && primary.length > 0) return primary;
    return (secondary || []).filter(Boolean);
  }

  const doiCrossrefCache = new Map<string, Promise<VerifyDOIResult | null>>();
  const doiOpenAlexCache = new Map<string, Promise<AcademicCandidate | null>>();
  const titleDoiCache = new Map<string, Promise<string | undefined>>();

  async function resolveDoiByTitle(title: string): Promise<string | undefined> {
    const key = normalizeTitleKey(title);
    if (!key) return undefined;

    const cached = titleDoiCache.get(key);
    if (cached) return await cached;

    const p = (async () => {
      const candidates = await searchCrossRef(title, {
        yearStart: plan.yearFrom,
        yearEnd: plan.yearTo,
        maxResults: 5,
      });

      let best: { doi: string; score: number } | null = null;
      for (const c of candidates) {
        if (!c.doi) continue;
        const s = titleSimilarity(title, c.title);
        if (!best || s > best.score) best = { doi: c.doi, score: s };
      }

      if (!best || best.score < 0.45) return undefined;
      return normalizeDoi(best.doi);
    })();

    titleDoiCache.set(key, p);
    return await p;
  }

  async function getCrossref(doi: string): Promise<VerifyDOIResult | null> {
    const key = doi.toLowerCase();
    const cached = doiCrossrefCache.get(key);
    if (cached) return await cached;

    const p = (async () => {
      const res = await verifyDOI(doi);
      return res.valid ? res : null;
    })();

    doiCrossrefCache.set(key, p);
    return await p;
  }

  async function getOpenAlex(doi: string): Promise<AcademicCandidate | null> {
    const key = doi.toLowerCase();
    const cached = doiOpenAlexCache.get(key);
    if (cached) return await cached;

    const p = lookupOpenAlexWorkByDoi(doi).catch(() => null);
    doiOpenAlexCache.set(key, p);
    return await p;
  }

  async function enrichOne(article: UnifiedArticle): Promise<UnifiedArticle> {
    const out: UnifiedArticle = { ...article };

    // Step 1: DOI resolution (if missing)
    const currentDoi = normalizeDoi(out.doi);
    if (!currentDoi) {
      const resolved = await resolveDoiByTitle(out.title);
      if (resolved) {
        out.doi = resolved;
        if (!out.url) out.url = `https://doi.org/${resolved}`;
      }
    } else {
      out.doi = currentDoi;
    }

    const doi = normalizeDoi(out.doi);
    if (!doi) return out;

    // Step 2: hydrate via Crossref + OpenAlex (in parallel)
    const [cr, oa] = await Promise.all([getCrossref(doi), getOpenAlex(doi)]);

    // Authors
    out.authors = mergeAuthors(out.authors || [], cr?.authors || oa?.authors);

    // Year
    if (isMissingScalar(out.year) && cr?.year) out.year = String(cr.year);
    if (isMissingScalar(out.year) && oa?.year) out.year = String(oa.year);

    // Journal
    if (isMissingScalar(out.journal) && oa?.journal) out.journal = oa.journal;
    if (isMissingScalar(out.journal) && cr?.journal) out.journal = cr.journal;

    // Volume/issue/pages (Crossref is best)
    if (isMissingScalar(out.volume) && cr?.volume) out.volume = cr.volume;
    if (isMissingScalar(out.issue) && cr?.issue) out.issue = cr.issue;
    if (isMissingScalar(out.pages) && cr?.pages) out.pages = cr.pages;

    // Abstract
    if (!hasMeaningfulAbstract(out.abstract) && oa?.abstract) out.abstract = oa.abstract;
    if (!hasMeaningfulAbstract(out.abstract) && cr?.abstract) out.abstract = cr.abstract;

    // Keywords
    if ((out.keywords || []).length === 0) {
      out.keywords = mergeKeywords(oa?.keywords, cr?.keywords);
    } else {
      out.keywords = mergeKeywords(out.keywords, oa?.keywords, cr?.keywords);
    }
    if ((out.keywords || []).length > 15) out.keywords = (out.keywords || []).slice(0, 15);

    // Language
    if (isMissingScalar(out.language) && oa?.language) out.language = oa.language;
    if (isMissingScalar(out.language) && cr?.url) {
      // Crossref doesn't always provide a clean language code; keep current if unknown.
    }

    // Document type
    if (isMissingScalar(out.documentType) && oa?.documentType) out.documentType = oa.documentType;

    // City / Country
    if (isMissingScalar(out.country) && oa?.country) out.country = oa.country;
    if (isMissingScalar(out.country) && cr?.country) out.country = cr.country;
    if (isMissingScalar(out.city) && oa?.city) out.city = oa.city;
    if (isMissingScalar(out.city) && cr?.city) out.city = cr.city;

    // URL
    if (!out.url && oa?.landingUrl) out.url = oa.landingUrl;

    return out;
  }

  function computeCoverage(articles: UnifiedArticle[]): AcademicArticlesExportResult["stats"]["coverage"] {
    const keys = ["doi", "abstract", "keywords", "journal", "city", "country", "language", "documentType"] as const;
    const cov: any = {};
    for (const k of keys) cov[k] = { present: 0, missing: 0 };

    for (const a of articles) {
      cov.doi[normalizeDoi(a.doi) ? "present" : "missing"]++;
      cov.journal[!isMissingScalar(a.journal) ? "present" : "missing"]++;
      cov.abstract[hasMeaningfulAbstract(a.abstract) ? "present" : "missing"]++;
      cov.keywords[(a.keywords || []).length > 0 ? "present" : "missing"]++;
      cov.language[!isMissingScalar(a.language) ? "present" : "missing"]++;
      cov.documentType[!isMissingScalar(a.documentType) ? "present" : "missing"]++;
      cov.city[!isMissingScalar(a.city) ? "present" : "missing"]++;
      cov.country[!isMissingScalar(a.country) ? "present" : "missing"]++;
    }

    return cov;
  }

  // 1) Fetch a large candidate pool (variants help reach 100 under strict geo filters)
  const queries = buildQueryVariants(plan.topicQuery);
  const allCandidates: UnifiedArticle[] = [];
  const allErrors: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const variantSources = i === 0
      ? sources
      : sources.filter((s) => s === "openalex" || s === "duckduckgo");

    const searchResult = await unifiedArticleSearch.searchAllSources(q, {
      maxResults: internalMaxResults,
      maxPerSource: internalMaxPerSource,
      startYear: plan.yearFrom,
      endYear: plan.yearTo,
      sources: variantSources,
      affilCountries: plan.affilCountries,
    });

    allCandidates.push(...searchResult.articles);
    allErrors.push(...(searchResult.errors || []));

    const deduped = dedupeUnifiedArticles(allCandidates);
    const filtered = deduped.filter((a) => isAllowedByRegion(a, plan, allowedCountries));

    // Once we have enough pool, stop searching to keep latency bounded.
    if (filtered.length >= Math.max(plan.requestedCount * 2, plan.requestedCount + 30)) {
      break;
    }
  }

  const dedupedPool = dedupeUnifiedArticles(allCandidates);
  const regionFilteredPool = dedupedPool.filter((a) => isAllowedByRegion(a, plan, allowedCountries));

  // 2) Enrich the top pool to maximize completeness
  const enrichPool = regionFilteredPool
    .slice(0, Math.min(regionFilteredPool.length, Math.max(180, plan.requestedCount * 3)));

  const enrichedPool = await mapLimit(enrichPool, 6, async (a) => enrichOne(a));
  const enrichedDeduped = dedupeUnifiedArticles(enrichedPool);
  const enrichedRegionFiltered = enrichedDeduped.filter((a) => isAllowedByRegion(a, plan, allowedCountries));

  // 3) Rank by completeness, then source preference, then year desc
  const sourceRank: Record<string, number> = { scopus: 5, wos: 4, openalex: 3, scielo: 2, redalyc: 2, duckduckgo: 1, pubmed: 1 };
  const ranked = [...enrichedRegionFiltered].sort((a, b) => {
    const sa = completenessScore(a);
    const sb = completenessScore(b);
    if (sb !== sa) return sb - sa;
    const ra = sourceRank[a.source] || 0;
    const rb = sourceRank[b.source] || 0;
    if (rb !== ra) return rb - ra;
    const ya = parseInt(a.year || "", 10);
    const yb = parseInt(b.year || "", 10);
    if (Number.isFinite(ya) && Number.isFinite(yb) && yb !== ya) return yb - ya;
    const ak = (a.authors?.[0] || "").toLowerCase();
    const bk = (b.authors?.[0] || "").toLowerCase();
    if (ak !== bk) return ak.localeCompare(bk);
    return (a.title || "").localeCompare(b.title || "");
  });

  const finalArticles = ranked.slice(0, plan.requestedCount);

  if (finalArticles.length < plan.requestedCount) {
    notes.push(`No se lograron ${plan.requestedCount} articulos con los filtros; se encontraron ${finalArticles.length}.`);
  }

  const uniqueErrors = Array.from(new Set(allErrors.map((e) => (e || "").trim()).filter(Boolean)));
  for (const e of uniqueErrors.slice(0, 5)) notes.push(e);

  const excelBuffer = await generateAcademicArticlesExcel(finalArticles);
  const wordBuffer = await generateApaReferencesDocx(plan.topicQuery, finalArticles);

  const bySource: Record<string, number> = {};
  for (const a of finalArticles) bySource[a.source] = (bySource[a.source] || 0) + 1;

  const coverage = computeCoverage(finalArticles);

  return {
    plan,
    articles: finalArticles,
    excelBuffer,
    wordBuffer,
    stats: {
      totalReturned: finalArticles.length,
      totalRequested: plan.requestedCount,
      bySource,
      coverage,
      notes,
    },
  };
}
