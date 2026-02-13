import { SourceSignal } from "./contracts";
import { franc } from "franc";

export interface ScopusArticle {
  scopusId: string;
  eid: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  abstract: string;
  keywords: string[];
  doi: string;
  citationCount: number;
  documentType: string;
  subtypeDescription?: string; // Extended
  language: string;
  affiliations: string[];
  affiliationCountry?: string; // Extended
  affiliationCity?: string;    // Extended
  url: string;
}



export interface ScopusSearchResult {
  articles: ScopusArticle[];
  totalResults: number;
  query: string;
  searchTime: number;
}

const SCOPUS_API_BASE = "https://api.elsevier.com/content/search/scopus";
const SCOPUS_ABSTRACT_BASE = "https://api.elsevier.com/content/abstract/scopus_id";

const SPANISH_TO_ENGLISH: Record<string, string> = {
  // Construction / Engineering
  "acero": "steel",
  "reciclado": "recycled",
  "reciclada": "recycled",
  "concreto": "concrete",
  "hormigón": "concrete",
  "hormigon": "concrete",
  "resistencia": "strength",
  "construcción": "construction",
  "construccion": "construction",
  "sostenible": "sustainable",
  "sustentable": "sustainable",
  "materiales": "materials",
  "cemento": "cement",
  "estructuras": "structures",
  "edificaciones": "buildings",
  "ingeniería": "engineering",
  "ingenieria": "engineering",
  "civil": "civil",
  "ambiental": "environmental",
  "impacto": "impact",
  "carbono": "carbon",
  "emisiones": "emissions",
  "propiedades": "properties",
  "mecánicas": "mechanical",
  "mecanicas": "mechanical",
  "fibras": "fibers",
  "refuerzo": "reinforcement",
  "influencia": "influence",
  "efecto": "effect",
  "comportamiento": "behavior",
  "análisis": "analysis",
  "analisis": "analysis",
  "evaluación": "evaluation",
  "evaluacion": "evaluation",
  "estudio": "study",
  "investigación": "research",
  "investigacion": "research",
  "artículos": "articles",
  "articulos": "articles",
  "científicos": "scientific",
  "cientificos": "scientific",
  // Medical / Health
  "embarazo": "pregnancy",
  "embarazada": "pregnant",
  "gestación": "gestation",
  "gestacion": "gestation",
  "prenatal": "prenatal",
  "postnatal": "postnatal",
  "parto": "childbirth",
  "cesárea": "cesarean",
  "cesarea": "cesarean",
  "obstetricia": "obstetrics",
  "ginecología": "gynecology",
  "ginecologia": "gynecology",
  "materno": "maternal",
  "materna": "maternal",
  "fetal": "fetal",
  "neonatal": "neonatal",
  "lactancia": "breastfeeding",
  "amamantar": "breastfeed",
  "recién nacido": "newborn",
  "complicaciones": "complications",
  "riesgo": "risk",
  "factor": "factor",
  "hospital": "hospital",
  "clínico": "clinical",
  "clinico": "clinical",
  "tratamiento": "treatment",
  "diagnóstico": "diagnosis",
  "diagnostico": "diagnosis",
  "paciente": "patient",
  "médico": "medical",
  "medico": "medical",
  "salud": "health",
  "enfermedad": "disease",
  "síntoma": "symptom",
  "sintoma": "symptom",
  "prevención": "prevention",
  "prevencion": "prevention",
  "atención": "care",
  "atencion": "care",
  "nutrición": "nutrition",
  "nutricion": "nutrition",
  "vitamina": "vitamin",
  "ácido fólico": "folic acid",
  "hierro": "iron",
  "anemia": "anemia",
  "diabetes": "diabetes",
  "gestacional": "gestational",
  "hipertensión": "hypertension",
  "hipertension": "hypertension",
  "preeclampsia": "preeclampsia",
  "eclampsia": "eclampsia",
  "mortalidad": "mortality",
  "morbilidad": "morbidity",
  // Business / Supply Chain / Sustainability (general)
  "economía": "economy",
  "economia": "economy",
  "circular": "circular",
  "cadena": "chain",
  "suministro": "supply",
  "logística": "logistics",
  "logistica": "logistics",
  "empresa": "company",
  "empresas": "companies",
  "exportadora": "exporting",
  "exportadoras": "exporting",
  "exportación": "export",
  "exportacion": "export",
  "exportar": "export",
};

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "a", "en", "con", "por", "para", "sobre",
  "y", "o", "que", "como", "su", "sus", "es", "son", "fue", "fueron",
  "uso", "the", "and", "or", "of", "in", "to", "for", "from", "with",
  "buscarme", "quiero", "necesito", "dame", "encuentra", "busca",
  "colocalo", "ordenado", "tabla", "excel", "articulos", "cientificos",
  // Region / filters often included in natural-language prompts
  "latinoamerica", "latinoamérica", "america", "américa", "latina", "latam",
  "españa", "espana", "solo", "solamente", "únicamente", "unicamente",
]);

export interface ExtractedKeywords {
  coreKeywords: string[];
  allKeywords: string[];
  yearRange?: { start: number; end: number };
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function quoteIfNeeded(term: string): string {
  const t = term.trim();
  if (!t) return "";
  // Keep wildcard/search operators unquoted.
  if (/[*?]/.test(t)) return t;
  if (/\b(AND|OR|NOT)\b/i.test(t)) return t;
  // Quote phrases or values with punctuation that can break the query.
  if (/\s|[()]/.test(t)) return `"${t.replace(/"/g, '\\"')}"`;
  return t.replace(/"/g, '\\"');
}

function detectLanguageName(text: string): string {
  const sample = (text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (sample.length < 30) return "Unknown";
  const code = franc(sample);
  switch (code) {
    case "spa": return "Spanish";
    case "por": return "Portuguese";
    case "eng": return "English";
    case "fra": return "French";
    case "deu": return "German";
    case "ita": return "Italian";
    default: return "Unknown";
  }
}

export function extractSearchKeywords(query: string): ExtractedKeywords {
  const yearMatch = query.match(/(\d{4})\s*(al|-|hasta|to)\s*(\d{4})/i);
  const yearRange = yearMatch
    ? { start: parseInt(yearMatch[1]), end: parseInt(yearMatch[3]) }
    : undefined;

  let cleanQuery = query
    .toLowerCase()
    .replace(/\d{4}\s*(al|-|hasta|to)\s*\d{4}/gi, "")
    .replace(/[""\"]/g, "")
    .replace(/[^\w\sáéíóúñü]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleanQuery.split(/\s+/);
  const allKeywords: string[] = [];

  // Phrase-level enrichment (helps Spanish prompts match English literature in Scopus).
  // We do this BEFORE single-word extraction so these key concepts have a chance to be included.
  const cleanNoAccents = stripAccents(cleanQuery);
  const PHRASE_MAP: Array<{ re: RegExp; add: string[] }> = [
    // Prefer English phrases to maximize recall in international indexes.
    // Spanish terms are still captured by the single-word loop below.
    { re: /\beconomia\s+circular\b/i, add: ["circular economy"] },
    { re: /\bcadena\s+de\s+suministro\b/i, add: ["supply chain"] },
    { re: /\bempresa(s)?\s+exportadora(s)?\b/i, add: ["export*"] },
  ];
  for (const { re, add } of PHRASE_MAP) {
    if (re.test(cleanNoAccents)) {
      for (const term of add) {
        const t = term.trim();
        if (!t) continue;
        if (!allKeywords.includes(t)) allKeywords.push(t);
      }
    }
  }

  for (const word of words) {
    if (word.length < 3) continue;
    if (STOPWORDS.has(word)) continue;

    const translated = SPANISH_TO_ENGLISH[word] || word;
    if (!allKeywords.includes(translated) && !STOPWORDS.has(translated)) {
      allKeywords.push(translated);
    }
  }

  // "coreKeywords" used to be domain-specific (construction/health). Make it generic:
  // pick the first 3 high-signal terms for relevance filtering.
  const coreKeywords = allKeywords.slice(0, 3);

  console.log(`[Scopus] Extracted keywords:`, { coreKeywords, allKeywords, yearRange });

  return { coreKeywords, allKeywords, yearRange };
}

export function buildScopusQuery(extracted: ExtractedKeywords): string {
  const { coreKeywords, allKeywords, yearRange } = extracted;

  const keywordsToUse = coreKeywords.length >= 2 ? coreKeywords : allKeywords.slice(0, 5);

  if (keywordsToUse.length === 0) {
    throw new Error("No valid keywords extracted from query");
  }

  const phraseQuery = keywordsToUse.map(quoteIfNeeded).filter(Boolean).join(" AND ");
  let scopusQuery = `TITLE-ABS-KEY(${phraseQuery})`;

  if (yearRange) {
    scopusQuery += ` AND PUBYEAR > ${yearRange.start - 1} AND PUBYEAR < ${yearRange.end + 1}`;
  }

  console.log(`[Scopus] Built query: ${scopusQuery}`);
  return scopusQuery;
}

export function translateToEnglish(query: string): string {
  const extracted = extractSearchKeywords(query);
  const keywords = extracted.coreKeywords.length >= 2
    ? extracted.coreKeywords
    : extracted.allKeywords.slice(0, 5);
  return keywords.join(" ");
}

export function filterByRelevance(
  articles: ScopusArticle[],
  requiredKeywords: string[]
): ScopusArticle[] {
  if (requiredKeywords.length === 0) return articles;

  const minKeywordsRequired = Math.min(2, requiredKeywords.length);

  return articles.filter(article => {
    const searchText = `${article.title} ${article.abstract} ${article.keywords.join(" ")}`.toLowerCase();

    let matchCount = 0;
    for (const keyword of requiredKeywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }

    const hasAbstract = article.abstract && article.abstract.length > 50;
    const isRelevant = matchCount >= minKeywordsRequired;

    if (!isRelevant) {
      console.log(`[Scopus] Filtered out: "${article.title.substring(0, 60)}..." (matched ${matchCount}/${requiredKeywords.length} keywords)`);
    }

    return isRelevant && hasAbstract;
  });
}

export async function searchScopus(
  query: string,
  options: {
    maxResults?: number;
    startYear?: number;
    endYear?: number;
    documentType?: string;
    affilCountries?: string[];
  } = {}
): Promise<ScopusSearchResult> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) {
    throw new Error("SCOPUS_API_KEY not configured");
  }

  const { maxResults = 25, documentType, affilCountries } = options;
  const startTime = Date.now();

  const extracted = extractSearchKeywords(query);
  console.log(`[Scopus] Original query: "${query}"`);

  const yearRange = extracted.yearRange ||
    (options.startYear && options.endYear
      ? { start: options.startYear, end: options.endYear }
      : undefined);

  const searchQuery = buildScopusQuery({ ...extracted, yearRange });

  let finalQuery = searchQuery;
  if (documentType) {
    finalQuery += ` AND DOCTYPE(${documentType})`;
  }
  if (affilCountries && affilCountries.length > 0) {
    const clause = buildAffilCountryClause(affilCountries);
    if (clause) finalQuery += ` AND (${clause})`;
  }

  const params = new URLSearchParams({
    query: finalQuery,
    count: Math.min(maxResults, 25).toString(),
    start: "0",
    sort: "-citedby-count",
    field: "dc:title,dc:creator,prism:coverDate,prism:publicationName,dc:description,authkeywords,prism:doi,citedby-count,subtypeDescription,dc:identifier,eid,affiliation,author",
  });

  const rawArticles: ScopusArticle[] = [];
  let totalResults = 0;
  let start = 0;
  const targetRaw = maxResults * 3;

  while (rawArticles.length < targetRaw) {
    params.set("start", start.toString());

    try {
      const response = await fetch(`${SCOPUS_API_BASE}?${params}`, {
        headers: {
          "X-ELS-APIKey": apiKey,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Scopus] API error: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const searchResults = data["search-results"];

      if (!searchResults || !searchResults.entry) {
        break;
      }

      totalResults = parseInt(searchResults["opensearch:totalResults"] || "0", 10);
      console.log(`[Scopus] Total in database: ${totalResults}`);

      for (const entry of searchResults.entry) {
        if (entry.error) continue;

        const eid = entry["eid"] || "";
        const scopusId = entry["dc:identifier"]?.replace("SCOPUS_ID:", "") || "";

        const scopusUrl = eid
          ? `https://www.scopus.com/record/display.uri?eid=${eid}&origin=resultslist`
          : entry.link?.find((l: any) => l["@ref"] === "scopus")?.["@href"] || "";

        const affiliationsList = extractAffiliations(entry.affiliation);
        const primaryAffiliation = getPrimaryAffiliation(entry.affiliation);

        const article: ScopusArticle = {
          scopusId,
          eid,
          title: entry["dc:title"] || "",
          authors: extractAuthors(entry),
          year: extractYear(entry["prism:coverDate"]),
          journal: entry["prism:publicationName"] || "",
          abstract: entry["dc:description"] || "",
          keywords: extractKeywords(entry["authkeywords"]),
          doi: entry["prism:doi"] || "",
          citationCount: parseInt(entry["citedby-count"] || "0", 10),
          documentType: entry["subtypeDescription"] || "Article",
          subtypeDescription: entry["subtypeDescription"],
          language: detectLanguageName(entry["dc:description"] || entry["dc:title"] || ""),
          affiliations: affiliationsList,
          affiliationCountry: primaryAffiliation.country,
          affiliationCity: primaryAffiliation.city,
          url: scopusUrl,
        };

        rawArticles.push(article);

        if (rawArticles.length >= targetRaw) break;
      }

      if (searchResults.entry.length < 25 || rawArticles.length >= targetRaw) {
        break;
      }

      start += 25;
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error: any) {
      console.error(`[Scopus] Search error: ${error.message}`);
      break;
    }
  }

  console.log(`[Scopus] Fetched ${rawArticles.length} raw articles, filtering by relevance...`);

  // Relevance filtering is helpful, but we must not under-deliver when the user asks for many results.
  // Strategy: try strict core-keyword filter, then relax to broader keywords, then fallback to "has abstract".
  let filteredArticles = filterByRelevance(rawArticles, extracted.coreKeywords);

  if (filteredArticles.length < maxResults) {
    const relaxedKeywords = extracted.allKeywords.slice(0, 8);
    const relaxed = filterByRelevance(rawArticles, relaxedKeywords);
    if (relaxed.length > filteredArticles.length) {
      filteredArticles = relaxed;
    }
  }

  if (filteredArticles.length < maxResults) {
    filteredArticles = rawArticles.filter(a => a.abstract && a.abstract.length > 50);
  }

  const finalArticles = filteredArticles.slice(0, maxResults);

  console.log(`[Scopus] After filtering: ${filteredArticles.length} relevant articles, returning ${finalArticles.length}`);

  return {
    articles: finalArticles,
    totalResults,
    query: searchQuery,
    searchTime: Date.now() - startTime,
  };
}

export async function fetchAbstract(scopusId: string): Promise<string> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) return "";

  try {
    const response = await fetch(`${SCOPUS_ABSTRACT_BASE}/${scopusId}`, {
      headers: {
        "X-ELS-APIKey": apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) return "";

    const data = await response.json();
    return data["abstracts-retrieval-response"]?.coredata?.["dc:description"] || "";
  } catch {
    return "";
  }
}

export function scopusArticlesToSourceSignals(articles: ScopusArticle[]): SourceSignal[] {
  return articles.map((article, index) => ({
    id: `scopus_${article.scopusId || article.eid || index}`,
    url: article.url,
    title: article.title,
    snippet: article.abstract.substring(0, 300),
    domain: "scopus.com",
    score: Math.min(1, 0.5 + (article.citationCount / 100)),
    fetched: true,
    content: article.abstract,
    claims: [],
    scopusData: article,
  }));
}

export function buildAffilCountryClause(countries: string[]): string {
  const unique = Array.from(new Set((countries || []).map(c => (c || "").trim()).filter(Boolean)));
  if (unique.length === 0) return "";
  // Build: AFFILCOUNTRY(Spain) OR AFFILCOUNTRY("Costa Rica") ...
  return unique.map(c => `AFFILCOUNTRY(${quoteIfNeeded(c)})`).join(" OR ");
}

function extractAuthors(entry: any): string[] {
  if (entry.author && Array.isArray(entry.author)) {
    return entry.author.map((a: any) => {
      if (a.authname) return a.authname;
      const given = a["given-name"] || a["ce:given-name"] || "";
      const surname = a.surname || a["ce:surname"] || "";
      return `${surname}, ${given}`.trim();
    }).filter(Boolean);
  }
  if (entry["dc:creator"]) {
    return [entry["dc:creator"]];
  }
  return [];
}

function extractYear(coverDate: string | undefined): string {
  if (!coverDate) return "";
  const match = coverDate.match(/(\d{4})/);
  return match ? match[1] : "";
}

function extractKeywords(authkeywords: string | undefined): string[] {
  if (!authkeywords) return [];
  return authkeywords.split("|").map(k => k.trim()).filter(Boolean);
}

function extractAffiliations(affiliations: any): string[] {
  if (!affiliations) return [];
  if (!Array.isArray(affiliations)) affiliations = [affiliations];
  return affiliations.map((a: any) => {
    const name = a.affilname || "";
    const city = a["affiliation-city"] || "";
    const country = a["affiliation-country"] || "";
    return [name, city, country].filter(Boolean).join(", ");
  }).filter(Boolean);
}

function getPrimaryAffiliation(affiliations: any): { country: string; city: string } {
  if (!affiliations) return { country: "", city: "" };
  if (!Array.isArray(affiliations)) affiliations = [affiliations];

  if (affiliations.length === 0) return { country: "", city: "" };

  // Return first affiliation details
  const first = affiliations[0];
  return {
    country: first["affiliation-country"] || "",
    city: first["affiliation-city"] || ""
  };
}

export function isScopusConfigured(): boolean {
  return !!process.env.SCOPUS_API_KEY;
}
