import {
  unifiedArticleSearch,
  type UnifiedArticle,
  type SearchOptions as UnifiedSearchOptions,
} from "../agent/superAgent/unifiedArticleSearch";
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

  // For region-restricted requests, avoid PubMed because we can't reliably enforce affiliation country.
  const sources: AcademicArticlesExportPlan["sources"] =
    region.latam || region.spain
      ? ["scopus", "scielo", "redalyc"]
      : ["scopus", "pubmed", "scielo", "redalyc"];

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

  // SciELO / Redalyc: many records don't expose a clean country. Treat "LatAm" as allowed only if requested.
  if (normalized === "latam") return plan.region.latam;

  // If we have a real country, enforce it.
  if (normalized.length > 0 && normalized !== "n.d.") return allowedCountries.has(normalized);

  // Unknown country: allow for LatAm requests (SciELO/Redalyc are LatAm-heavy),
  // otherwise drop to avoid leaking global content into a strict region filter.
  return plan.region.latam;
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

function buildApaCitationParts(article: UnifiedArticle): { preJournal: string; journal?: string; postJournal: string } {
  const authors = formatAuthorsAPA7(article.authors || []);
  const year = (article.year || "n.d.").trim() || "n.d.";
  const title = (article.title || "Untitled").replace(/\s+/g, " ").trim();
  const journal = (article.journal || "").replace(/\s+/g, " ").trim();

  const doiUrl = article.doi ? `https://doi.org/${article.doi}` : "";

  const safeTitle = title.endsWith(".") ? title : `${title}.`;

  if (!journal) {
    return {
      preJournal: `${authors} (${year}). ${safeTitle}`,
      postJournal: doiUrl ? ` ${doiUrl}` : "",
    };
  }

  return {
    preJournal: `${authors} (${year}). ${safeTitle} `,
    journal,
    postJournal: `.${doiUrl ? ` ${doiUrl}` : ""}`,
  };
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
    const parts = buildApaCitationParts(a);
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        indent: { hanging: 720, left: 720 },
        children: [
          new TextRun({ text: parts.preJournal, font: "Times New Roman", size: 24 }),
          ...(parts.journal
            ? [
              new TextRun({ text: parts.journal, italics: true, font: "Times New Roman", size: 24 }),
              new TextRun({ text: parts.postJournal, font: "Times New Roman", size: 24 }),
            ]
            : [
              new TextRun({ text: parts.postJournal, font: "Times New Roman", size: 24 }),
            ]),
        ],
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

export async function exportAcademicArticlesFromPrompt(prompt: string): Promise<AcademicArticlesExportResult> {
  const plan = planAcademicArticlesExport(prompt);
  const allowedCountries = plan.affilCountries
    ? new Set(plan.affilCountries.map(normalizeCountry))
    : null;

  const sources = plan.sources.filter((s) => {
    if (s === "scopus") return unifiedArticleSearch.isScopusConfigured();
    if (s === "pubmed") return unifiedArticleSearch.isPubMedConfigured();
    if (s === "scielo") return unifiedArticleSearch.isSciELOConfigured();
    if (s === "redalyc") return unifiedArticleSearch.isRedalycConfigured();
    return true;
  });

  // Ask for more than requested (up to 200) to survive dedupe + strict filters.
  const internalMaxResults = Math.min(200, Math.max(plan.requestedCount, plan.requestedCount * 2));
  const internalMaxPerSource = Math.min(150, Math.max(50, plan.requestedCount));

  const searchResult = await unifiedArticleSearch.searchAllSources(plan.topicQuery, {
    maxResults: internalMaxResults,
    maxPerSource: internalMaxPerSource,
    startYear: plan.yearFrom,
    endYear: plan.yearTo,
    sources,
    affilCountries: plan.affilCountries,
  });

  const filtered = searchResult.articles.filter((a) => isAllowedByRegion(a, plan, allowedCountries));
  const finalArticles = filtered.slice(0, plan.requestedCount);

  const excelBuffer = unifiedArticleSearch.generateExcelReport(finalArticles);
  const wordBuffer = await generateApaReferencesDocx(plan.topicQuery, finalArticles);

  const bySource: Record<string, number> = {};
  for (const a of finalArticles) {
    bySource[a.source] = (bySource[a.source] || 0) + 1;
  }

  return {
    plan,
    articles: finalArticles,
    excelBuffer,
    wordBuffer,
    stats: {
      totalReturned: finalArticles.length,
      totalRequested: plan.requestedCount,
      bySource,
    },
  };
}

