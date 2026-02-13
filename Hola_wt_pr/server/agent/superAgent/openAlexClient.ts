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

const COUNTRY_CODES: Record<string, string> = {
  "US": "United States", "GB": "United Kingdom", "UK": "United Kingdom",
  "CN": "China", "DE": "Germany", "FR": "France", "JP": "Japan",
  "BR": "Brazil", "IN": "India", "AU": "Australia", "CA": "Canada",
  "IT": "Italy", "ES": "Spain", "MX": "Mexico", "NL": "Netherlands",
  "KR": "South Korea", "IR": "Iran", "TR": "Turkey", "EG": "Egypt",
  "SA": "Saudi Arabia", "MY": "Malaysia", "ID": "Indonesia", "TH": "Thailand",
  "PT": "Portugal", "PL": "Poland", "RU": "Russia", "PK": "Pakistan",
  "NG": "Nigeria", "ZA": "South Africa", "CO": "Colombia", "CL": "Chile",
  "AR": "Argentina", "PE": "Peru", "VN": "Vietnam", "PH": "Philippines",
  "TW": "Taiwan", "SG": "Singapore", "HK": "Hong Kong", "GR": "Greece",
  "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland",
  "BE": "Belgium", "CH": "Switzerland", "AT": "Austria", "CZ": "Czech Republic",
  "HU": "Hungary", "RO": "Romania", "UA": "Ukraine", "IL": "Israel",
  "IQ": "Iraq", "JO": "Jordan", "LB": "Lebanon", "MA": "Morocco",
  "DZ": "Algeria", "TN": "Tunisia", "NZ": "New Zealand", "BD": "Bangladesh",
  "LK": "Sri Lanka", "IE": "Ireland", "AE": "United Arab Emirates",
};

const COUNTRY_NAMES_PATTERN = /\b(United States|USA|U\.S\.A\.|United Kingdom|UK|England|China|P\.R\. China|Germany|France|Japan|Brazil|Brasil|India|Australia|Canada|Italy|Italia|Spain|España|Mexico|México|Netherlands|South Korea|Korea|Iran|Turkey|Egypt|Saudi Arabia|Malaysia|Indonesia|Thailand|Portugal|Poland|Russia|Pakistan|Nigeria|South Africa|Colombia|Chile|Argentina|Peru|Vietnam|Philippines|Taiwan|Singapore|Hong Kong|Greece|Sweden|Norway|Denmark|Finland|Belgium|Switzerland|Austria|Czech Republic|Czechia|Hungary|Romania|Ukraine|Israel|Iraq|Jordan|Lebanon|Morocco|Algeria|Tunisia|New Zealand|Bangladesh|Sri Lanka|Ireland|United Arab Emirates|UAE)\b/i;

function extractCountryFromText(text: string): string {
  const match = text.match(COUNTRY_NAMES_PATTERN);
  if (match) {
    const found = match[1].toLowerCase();
    if (found === "usa" || found === "u.s.a." || found === "united states") return "United States";
    if (found === "uk" || found === "england" || found === "united kingdom") return "United Kingdom";
    if (found === "p.r. china") return "China";
    if (found === "brasil") return "Brazil";
    if (found === "italia") return "Italy";
    if (found === "españa") return "Spain";
    if (found === "méxico") return "Mexico";
    if (found === "korea" || found === "south korea") return "South Korea";
    if (found === "czechia") return "Czech Republic";
    if (found === "uae") return "United Arab Emirates";
    return match[1];
  }
  return "";
}

const KNOWN_CITIES: Record<string, string> = {
  "beijing": "Beijing", "shanghai": "Shanghai", "guangzhou": "Guangzhou", "shenzhen": "Shenzhen",
  "new york": "New York", "los angeles": "Los Angeles", "chicago": "Chicago", "boston": "Boston",
  "san francisco": "San Francisco", "houston": "Houston", "seattle": "Seattle", "atlanta": "Atlanta",
  "london": "London", "manchester": "Manchester", "birmingham": "Birmingham", "cambridge": "Cambridge",
  "oxford": "Oxford", "edinburgh": "Edinburgh", "glasgow": "Glasgow", "bristol": "Bristol",
  "tokyo": "Tokyo", "osaka": "Osaka", "kyoto": "Kyoto", "nagoya": "Nagoya", "yokohama": "Yokohama",
  "berlin": "Berlin", "munich": "Munich", "frankfurt": "Frankfurt", "hamburg": "Hamburg", "cologne": "Cologne",
  "paris": "Paris", "lyon": "Lyon", "marseille": "Marseille", "toulouse": "Toulouse",
  "sydney": "Sydney", "melbourne": "Melbourne", "brisbane": "Brisbane", "perth": "Perth",
  "toronto": "Toronto", "vancouver": "Vancouver", "montreal": "Montreal", "ottawa": "Ottawa",
  "delhi": "Delhi", "mumbai": "Mumbai", "bangalore": "Bangalore", "chennai": "Chennai", "hyderabad": "Hyderabad",
  "sao paulo": "São Paulo", "rio de janeiro": "Rio de Janeiro", "brasilia": "Brasilia",
  "madrid": "Madrid", "barcelona": "Barcelona", "valencia": "Valencia", "seville": "Seville",
  "rome": "Rome", "milan": "Milan", "naples": "Naples", "turin": "Turin", "florence": "Florence",
  "amsterdam": "Amsterdam", "rotterdam": "Rotterdam", "the hague": "The Hague", "utrecht": "Utrecht",
  "seoul": "Seoul", "busan": "Busan", "incheon": "Incheon", "daegu": "Daegu",
  "singapore": "Singapore", "hong kong": "Hong Kong", "taipei": "Taipei", "kaohsiung": "Kaohsiung",
  "moscow": "Moscow", "saint petersburg": "Saint Petersburg", "st. petersburg": "Saint Petersburg",
  "cairo": "Cairo", "alexandria": "Alexandria", "giza": "Giza",
  "istanbul": "Istanbul", "ankara": "Ankara", "izmir": "Izmir",
  "tehran": "Tehran", "isfahan": "Isfahan", "tabriz": "Tabriz",
  "riyadh": "Riyadh", "jeddah": "Jeddah", "mecca": "Mecca",
  "dubai": "Dubai", "abu dhabi": "Abu Dhabi", "sharjah": "Sharjah",
  "kuala lumpur": "Kuala Lumpur", "penang": "Penang", "johor bahru": "Johor Bahru",
  "jakarta": "Jakarta", "surabaya": "Surabaya", "bandung": "Bandung",
  "bangkok": "Bangkok", "chiang mai": "Chiang Mai", "phuket": "Phuket",
  "hanoi": "Hanoi", "ho chi minh": "Ho Chi Minh City", "ho chi minh city": "Ho Chi Minh City",
  "manila": "Manila", "quezon city": "Quezon City", "cebu": "Cebu",
  "lima": "Lima", "bogota": "Bogotá", "bogotá": "Bogotá", "santiago": "Santiago",
  "buenos aires": "Buenos Aires", "cordoba": "Córdoba", "rosario": "Rosario",
  "mexico city": "Mexico City", "guadalajara": "Guadalajara", "monterrey": "Monterrey",
  "johannesburg": "Johannesburg", "cape town": "Cape Town", "durban": "Durban", "pretoria": "Pretoria",
  "lagos": "Lagos", "abuja": "Abuja", "nairobi": "Nairobi", "accra": "Accra",
  "tel aviv": "Tel Aviv", "jerusalem": "Jerusalem", "haifa": "Haifa",
  "vienna": "Vienna", "zurich": "Zurich", "geneva": "Geneva", "brussels": "Brussels",
  "copenhagen": "Copenhagen", "stockholm": "Stockholm", "oslo": "Oslo", "helsinki": "Helsinki",
  "prague": "Prague", "warsaw": "Warsaw", "budapest": "Budapest", "bucharest": "Bucharest",
  "athens": "Athens", "thessaloniki": "Thessaloniki", "lisbon": "Lisbon", "porto": "Porto",
  "dublin": "Dublin", "cork": "Cork", "belfast": "Belfast",
};

function extractCityFromText(text: string): string {
  const lower = text.toLowerCase();
  for (const [pattern, cityName] of Object.entries(KNOWN_CITIES)) {
    if (lower.includes(pattern)) {
      return cityName;
    }
  }
  const parts = text.split(/[,;]/);
  if (parts.length >= 2) {
    const possibleCity = parts[parts.length - 2].trim();
    if (possibleCity.length > 2 && possibleCity.length < 40 && !/^\d/.test(possibleCity) && !/university|institute|college|department|school|faculty|center|centre/i.test(possibleCity)) {
      return possibleCity;
    }
  }
  return "";
}

function extractCountryFromAffiliations(authorships: OpenAlexWork["authorships"]): string {
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      if (inst.country_code) {
        return COUNTRY_CODES[inst.country_code.toUpperCase()] || inst.country_code;
      }
      const fromText = extractCountryFromText(inst.display_name);
      if (fromText) return fromText;
    }
  }
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      const fromText = extractCountryFromText(inst.display_name);
      if (fromText) return fromText;
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
  for (const auth of authorships) {
    for (const inst of auth.institutions) {
      const fromText = extractCityFromText(inst.display_name);
      if (fromText) return fromText;
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
