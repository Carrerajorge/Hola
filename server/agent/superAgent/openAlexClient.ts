export interface OpenAlexWork {
  id: string;
  doi: string;
  title: string;
  publication_year: number;
  publication_date: string;
  primary_location: {
    source?: {
      display_name?: string;
    };
    landing_page_url?: string;
  } | null;
  authorships: Array<{
    author: {
      display_name: string;
    };
    institutions: Array<{
      display_name: string;
      country_code?: string;
      city?: string;
    }>;
  }>;
  abstract_inverted_index: Record<string, number[]> | null;
  keywords: Array<{ keyword: string }>;
  concepts: Array<{ display_name: string; score: number }>;
  cited_by_count: number;
  type: string;
  language: string;
  open_access: {
    is_oa: boolean;
    oa_url?: string;
  };
}

export interface AcademicCandidate {
  source: "openalex" | "crossref" | "semantic_scholar" | "scopus";
  sourceId: string;
  doi: string;
  title: string;
  year: number;
  journal: string;
  abstract: string;
  authors: string[];
  keywords: string[];
  language: string;
  documentType: string;
  citationCount: number;
  affiliations: string[];
  city: string;
  country: string;
  landingUrl: string;
  doiUrl: string;
  verified: boolean;
  relevanceScore: number;
  verificationStatus: "pending" | "verified" | "failed";
}

const OPENALEX_BASE = "https://api.openalex.org/works";
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

function invertedIndexToText(inverted: Record<string, number[]> | null): string {
  if (!inverted) return "";
  
  const words: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words.push([word, pos]);
    }
  }
  words.sort((a, b) => a[1] - b[1]);
  return words.map(w => w[0]).join(" ");
}

function extractCountryFromAffiliations(authorships: OpenAlexWork["authorships"]): string {
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      if (inst.country_code) {
        return inst.country_code;
      }
    }
  }
  return "Unknown";
}

function extractCityFromAffiliations(authorships: OpenAlexWork["authorships"]): string {
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      if (inst.city) {
        return inst.city;
      }
    }
  }
  return "Unknown";
}

export async function searchOpenAlex(
  query: string,
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const { yearStart = 2020, yearEnd = 2025, maxResults = 100 } = options;
  
  await rateLimit();

  const searchTerms = query.split(/\s+AND\s+|\s+/).filter(t => t.length > 2);
  const searchQuery = searchTerms.join(" ");
  
  const params = new URLSearchParams({
    search: searchQuery,
    filter: `from_publication_date:${yearStart}-01-01,to_publication_date:${yearEnd}-12-31`,
    "per-page": String(Math.min(maxResults, 200)),
    sort: "cited_by_count:desc",
  });

  const url = `${OPENALEX_BASE}?${params}`;
  console.log(`[OpenAlex] Searching: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT/1.0 (mailto:research@iliagpt.com)",
      },
    });

    if (!response.ok) {
      console.error(`[OpenAlex] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = data.results || [];
    
    console.log(`[OpenAlex] Found ${results.length} results from ${data.meta?.count || 0} total`);

    const candidates: AcademicCandidate[] = results.map((work: OpenAlexWork) => {
      const doi = work.doi?.replace("https://doi.org/", "") || "";
      const abstract = invertedIndexToText(work.abstract_inverted_index);
      
      return {
        source: "openalex" as const,
        sourceId: work.id,
        doi,
        title: work.title || "",
        year: work.publication_year || 0,
        journal: work.primary_location?.source?.display_name || "Unknown",
        abstract,
        authors: work.authorships.map(a => a.author.display_name).filter(Boolean),
        keywords: work.keywords?.map(k => k.keyword) || work.concepts?.slice(0, 5).map(c => c.display_name) || [],
        language: work.language || "en",
        documentType: work.type || "article",
        citationCount: work.cited_by_count || 0,
        affiliations: work.authorships.flatMap(a => a.institutions.map(i => i.display_name)).filter(Boolean),
        city: extractCityFromAffiliations(work.authorships),
        country: extractCountryFromAffiliations(work.authorships),
        landingUrl: work.primary_location?.landing_page_url || work.open_access?.oa_url || "",
        doiUrl: doi ? `https://doi.org/${doi}` : "",
        verified: false,
        relevanceScore: 0,
        verificationStatus: "pending" as const,
      };
    });

    return candidates;
  } catch (error: any) {
    console.error(`[OpenAlex] Search error: ${error.message}`);
    return [];
  }
}

export async function searchOpenAlexWithMultipleQueries(
  queries: string[],
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const allCandidates: AcademicCandidate[] = [];
  const seenDois = new Set<string>();

  for (const query of queries) {
    const candidates = await searchOpenAlex(query, options);
    
    for (const candidate of candidates) {
      const key = candidate.doi || candidate.title.toLowerCase().substring(0, 50);
      if (!seenDois.has(key)) {
        seenDois.add(key);
        allCandidates.push(candidate);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allCandidates;
}
