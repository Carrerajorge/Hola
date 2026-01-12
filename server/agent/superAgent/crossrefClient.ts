import { AcademicCandidate } from "./openAlexClient";

const CROSSREF_WORKS_BASE = "https://api.crossref.org/works";
const RATE_LIMIT_MS = 100;

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface CrossRefWork {
  DOI: string;
  title: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    affiliation?: Array<{ name: string }>;
  }>;
  "container-title"?: string[];
  abstract?: string;
  published?: { "date-parts": number[][] };
  "published-print"?: { "date-parts": number[][] };
  "published-online"?: { "date-parts": number[][] };
  issued?: { "date-parts": number[][] };
  type?: string;
  language?: string;
  subject?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
  link?: Array<{ URL: string; "content-type"?: string }>;
}

export interface CrossRefMetadata {
  doi: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  abstract: string;
  documentType: string;
  language: string;
  keywords: string[];
  citationCount: number;
  url: string;
  publisher: string;
  affiliations: string[];
}

function extractYear(work: CrossRefWork): number {
  const dateParts = 
    work.published?.["date-parts"]?.[0] ||
    work["published-print"]?.["date-parts"]?.[0] ||
    work["published-online"]?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  
  return dateParts?.[0] || 0;
}

function cleanAbstract(abstract: string | undefined): string {
  if (!abstract) return "";
  return abstract
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function lookupDOI(doi: string): Promise<CrossRefMetadata | null> {
  await rateLimit();

  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, "");
  const url = `${CROSSREF_WORKS_BASE}/${encodeURIComponent(cleanDoi)}`;
  
  console.log(`[CrossRef] Looking up DOI: ${cleanDoi}`);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT/1.0 (mailto:research@iliagpt.com)",
      },
    });

    if (!response.ok) {
      console.error(`[CrossRef] DOI lookup failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const work: CrossRefWork = data.message;

    if (!work) return null;

    const authors = (work.author || []).map(a => {
      if (a.name) return a.name;
      return [a.family, a.given].filter(Boolean).join(", ");
    }).filter(Boolean);

    const affiliations: string[] = [];
    for (const author of work.author || []) {
      for (const aff of author.affiliation || []) {
        if (aff.name && !affiliations.includes(aff.name)) {
          affiliations.push(aff.name);
        }
      }
    }

    return {
      doi: work.DOI,
      title: work.title?.[0] || "",
      authors,
      year: extractYear(work),
      journal: work["container-title"]?.[0] || "Unknown",
      abstract: cleanAbstract(work.abstract),
      documentType: work.type || "article",
      language: work.language || "en",
      keywords: work.subject || [],
      citationCount: work["is-referenced-by-count"] || 0,
      url: work.URL || `https://doi.org/${work.DOI}`,
      publisher: "CrossRef",
      affiliations,
    };
  } catch (error: any) {
    console.error(`[CrossRef] Lookup error: ${error.message}`);
    return null;
  }
}

export async function searchCrossRef(
  query: string,
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const { yearStart = 2020, yearEnd = 2025, maxResults = 100 } = options;
  
  await rateLimit();

  const params = new URLSearchParams({
    query,
    rows: String(Math.min(maxResults, 100)),
    filter: `from-pub-date:${yearStart},until-pub-date:${yearEnd}`,
    sort: "relevance",
  });

  const url = `${CROSSREF_WORKS_BASE}?${params}`;
  console.log(`[CrossRef] Searching: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT/1.0 (mailto:research@iliagpt.com)",
      },
    });

    if (!response.ok) {
      console.error(`[CrossRef] Search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items = data.message?.items || [];
    
    console.log(`[CrossRef] Found ${items.length} results from ${data.message?.["total-results"] || 0} total`);

    const candidates: AcademicCandidate[] = items.map((work: CrossRefWork) => {
      const authors = (work.author || []).map(a => {
        if (a.name) return a.name;
        return [a.family, a.given].filter(Boolean).join(", ");
      }).filter(Boolean);

      const affiliations: string[] = [];
      for (const author of work.author || []) {
        for (const aff of author.affiliation || []) {
          if (aff.name && !affiliations.includes(aff.name)) {
            affiliations.push(aff.name);
          }
        }
      }

      return {
        source: "crossref" as const,
        sourceId: work.DOI,
        doi: work.DOI,
        title: work.title?.[0] || "",
        year: extractYear(work),
        journal: work["container-title"]?.[0] || "Unknown",
        abstract: cleanAbstract(work.abstract),
        authors,
        keywords: work.subject || [],
        language: work.language || "en",
        documentType: work.type || "article",
        citationCount: work["is-referenced-by-count"] || 0,
        affiliations,
        city: "Unknown",
        country: "Unknown",
        landingUrl: work.URL || "",
        doiUrl: work.DOI ? `https://doi.org/${work.DOI}` : "",
        verified: false,
        relevanceScore: 0,
        verificationStatus: "pending" as const,
      };
    });

    return candidates;
  } catch (error: any) {
    console.error(`[CrossRef] Search error: ${error.message}`);
    return [];
  }
}

export async function verifyDOI(doi: string): Promise<{ valid: boolean; url: string; title: string }> {
  const metadata = await lookupDOI(doi);
  
  if (!metadata) {
    return { valid: false, url: "", title: "" };
  }

  return {
    valid: true,
    url: metadata.url,
    title: metadata.title,
  };
}
