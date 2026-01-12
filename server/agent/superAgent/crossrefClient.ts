import { AcademicCandidate } from "./openAlexClient";

const CROSSREF_WORKS_BASE = "https://api.crossref.org/works";
const RATE_LIMIT_MS = 200;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateLimit();
    const response = await fetch(url, options);
    if (response.status === 429 && attempt < retries) {
      const waitTime = BACKOFF_BASE_MS * Math.pow(2, attempt);
      console.log(`[CrossRef] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${retries}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    return response;
  }
  throw new Error("Max retries exceeded");
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
  city: string;
  country: string;
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

const COUNTRY_PATTERNS: Record<string, string> = {
  "usa": "United States", "u.s.a.": "United States", "united states": "United States",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "united kingdom": "United Kingdom", "england": "United Kingdom",
  "china": "China", "p.r. china": "China", "pr china": "China",
  "germany": "Germany", "deutschland": "Germany",
  "france": "France", "japan": "Japan", "brazil": "Brazil", "brasil": "Brazil",
  "india": "India", "australia": "Australia", "canada": "Canada",
  "italy": "Italy", "italia": "Italy", "spain": "Spain", "españa": "Spain",
  "mexico": "Mexico", "méxico": "Mexico", "netherlands": "Netherlands",
  "south korea": "South Korea", "korea": "South Korea", "republic of korea": "South Korea",
  "iran": "Iran", "turkey": "Turkey", "egypt": "Egypt", "saudi arabia": "Saudi Arabia",
  "malaysia": "Malaysia", "indonesia": "Indonesia", "thailand": "Thailand",
  "portugal": "Portugal", "poland": "Poland", "russia": "Russia",
  "pakistan": "Pakistan", "nigeria": "Nigeria", "south africa": "South Africa",
  "colombia": "Colombia", "chile": "Chile", "argentina": "Argentina", "peru": "Peru",
  "vietnam": "Vietnam", "philippines": "Philippines", "taiwan": "Taiwan",
  "singapore": "Singapore", "hong kong": "Hong Kong", "greece": "Greece",
  "sweden": "Sweden", "norway": "Norway", "denmark": "Denmark", "finland": "Finland",
  "belgium": "Belgium", "switzerland": "Switzerland", "austria": "Austria",
  "czech republic": "Czech Republic", "czechia": "Czech Republic",
  "hungary": "Hungary", "romania": "Romania", "ukraine": "Ukraine",
  "israel": "Israel", "iraq": "Iraq", "jordan": "Jordan", "lebanon": "Lebanon",
  "morocco": "Morocco", "algeria": "Algeria", "tunisia": "Tunisia",
  "new zealand": "New Zealand", "bangladesh": "Bangladesh", "sri lanka": "Sri Lanka",
};

function extractLocationFromAffiliations(affiliations: string[]): { city: string; country: string } {
  let city = "Unknown";
  let country = "Unknown";

  for (const aff of affiliations) {
    const lower = aff.toLowerCase();
    
    for (const [pattern, countryName] of Object.entries(COUNTRY_PATTERNS)) {
      if (lower.includes(pattern)) {
        country = countryName;
        break;
      }
    }
    
    if (country !== "Unknown") {
      const parts = aff.split(/[,;]/);
      if (parts.length >= 2) {
        const possibleCity = parts[parts.length - 2].trim();
        if (possibleCity.length > 2 && possibleCity.length < 50 && !/^\d/.test(possibleCity)) {
          city = possibleCity;
        }
      }
      break;
    }
  }

  return { city, country };
}

export async function lookupDOI(doi: string): Promise<CrossRefMetadata | null> {
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, "");
  const url = `${CROSSREF_WORKS_BASE}/${encodeURIComponent(cleanDoi)}`;
  
  console.log(`[CrossRef] Looking up DOI: ${cleanDoi}`);

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT/1.0 (mailto:research@iliagpt.com)",
      },
    });

    if (!response.ok) {
      if (response.status !== 429) {
        console.error(`[CrossRef] DOI lookup failed: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();
    const work: CrossRefWork = data.message;

    if (!work) return null;

    const authors = (work.author || []).map(a => {
      if (a.name) return a.name;
      const given = a.given || "";
      const family = a.family || "";
      return [given, family].filter(Boolean).join(" ").trim();
    }).filter(Boolean);

    const affiliations: string[] = [];
    for (const author of work.author || []) {
      for (const aff of author.affiliation || []) {
        if (aff.name && !affiliations.includes(aff.name)) {
          affiliations.push(aff.name);
        }
      }
    }

    const { city, country } = extractLocationFromAffiliations(affiliations);

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
      city,
      country,
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

export interface VerifyDOIResult {
  valid: boolean;
  url: string;
  title: string;
  city?: string;
  country?: string;
  year?: number;
  authors?: string[];
  journal?: string;
  abstract?: string;
  keywords?: string[];
}

export async function verifyDOI(doi: string): Promise<VerifyDOIResult> {
  const metadata = await lookupDOI(doi);
  
  if (!metadata) {
    return { valid: false, url: "", title: "" };
  }

  return {
    valid: true,
    url: metadata.url,
    title: metadata.title,
    city: metadata.city,
    country: metadata.country,
    year: metadata.year,
    authors: metadata.authors,
    journal: metadata.journal,
    abstract: metadata.abstract,
    keywords: metadata.keywords,
  };
}
