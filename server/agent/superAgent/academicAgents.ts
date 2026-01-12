import { AcademicCandidate } from "./openAlexClient";
import { lookupDOI, verifyDOI } from "./crossrefClient";

const RELEVANCE_THRESHOLD = 0.72;

const REQUIRED_KEYWORDS = {
  material: ["concrete", "mortar", "cement", "cementitious"],
  steel: ["recycled steel", "scrap steel", "steel fiber", "steel fibre", "recycled reinforcement", "steel slag", "recycled aggregate"],
  property: ["strength", "compressive", "tensile", "flexural", "mechanical", "durability", "resistance"],
};

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RelevanceResult {
  passed: boolean;
  score: number;
  reason: string;
  matchedGroups: string[];
}

export function checkRelevance(candidate: AcademicCandidate): RelevanceResult {
  const text = normalize(`${candidate.title} ${candidate.abstract}`);
  
  const matchedGroups: string[] = [];
  
  const hasMaterial = REQUIRED_KEYWORDS.material.some(kw => text.includes(kw));
  if (hasMaterial) matchedGroups.push("material");
  
  const hasSteel = REQUIRED_KEYWORDS.steel.some(kw => text.includes(kw));
  if (hasSteel) matchedGroups.push("steel");
  
  const hasProperty = REQUIRED_KEYWORDS.property.some(kw => text.includes(kw));
  if (hasProperty) matchedGroups.push("property");

  if (!hasMaterial || !hasSteel || !hasProperty) {
    return {
      passed: false,
      score: 0,
      reason: `Missing required keywords: ${["material", "steel", "property"].filter((g, i) => ![hasMaterial, hasSteel, hasProperty][i]).join(", ")}`,
      matchedGroups,
    };
  }

  let count = 0;
  for (const keywords of Object.values(REQUIRED_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/\s+/g, "\\s*"), "gi");
      const matches = text.match(regex);
      count += matches ? matches.length : 0;
    }
  }

  const hasAbstract = candidate.abstract && candidate.abstract.length > 100;
  
  const baseScore = 0.6 + 0.08 * Math.min(5, count);
  const abstractPenalty = hasAbstract ? 0 : 0.2;
  const score = Math.min(1.0, baseScore - abstractPenalty);
  
  if (!hasAbstract) {
    return {
      passed: false,
      score,
      reason: "Abstract too short or missing",
      matchedGroups,
    };
  }

  if (score < RELEVANCE_THRESHOLD) {
    return {
      passed: false,
      score,
      reason: `Score too low: ${score.toFixed(2)} < ${RELEVANCE_THRESHOLD}`,
      matchedGroups,
    };
  }

  return {
    passed: true,
    score,
    reason: `Relevant (score: ${score.toFixed(2)})`,
    matchedGroups,
  };
}

export function filterByRelevanceAgent(candidates: AcademicCandidate[]): AcademicCandidate[] {
  console.log(`[RelevanceAgent] Filtering ${candidates.length} candidates...`);
  
  const passed: AcademicCandidate[] = [];
  const failed: { title: string; reason: string }[] = [];

  for (const candidate of candidates) {
    const result = checkRelevance(candidate);
    
    if (result.passed) {
      candidate.relevanceScore = result.score;
      passed.push(candidate);
    } else {
      failed.push({ 
        title: candidate.title.substring(0, 60), 
        reason: result.reason 
      });
    }
  }

  console.log(`[RelevanceAgent] Passed: ${passed.length}, Failed: ${failed.length}`);
  
  if (failed.length > 0 && failed.length <= 10) {
    for (const f of failed) {
      console.log(`[RelevanceAgent] Rejected: "${f.title}..." - ${f.reason}`);
    }
  }

  return passed;
}

export interface VerificationResult {
  verified: boolean;
  doiValid: boolean;
  urlAccessible: boolean;
  titleMatch: number;
  finalUrl: string;
  reason: string;
}

function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const na = normalize(a);
  const nb = normalize(b);
  
  if (na === nb) return 1.0;
  if (!na || !nb) return 0;

  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

export async function verifyCandidate(
  candidate: AcademicCandidate,
  yearStart: number = 2020,
  yearEnd: number = 2025
): Promise<VerificationResult> {
  if (!candidate.doi) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: "No DOI available",
    };
  }

  if (candidate.year && (candidate.year < yearStart || candidate.year > yearEnd)) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: `Year ${candidate.year} outside valid range ${yearStart}-${yearEnd}`,
    };
  }

  const doiResult = await verifyDOI(candidate.doi);
  
  if (!doiResult.valid) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: "DOI not found in CrossRef",
    };
  }

  const similarity = titleSimilarity(candidate.title, doiResult.title);
  
  if (similarity < 0.4) {
    return {
      verified: false,
      doiValid: true,
      urlAccessible: true,
      titleMatch: similarity,
      finalUrl: doiResult.url,
      reason: `Title mismatch: similarity ${(similarity * 100).toFixed(0)}% < 40%`,
    };
  }

  return {
    verified: true,
    doiValid: true,
    urlAccessible: true,
    titleMatch: similarity,
    finalUrl: doiResult.url,
    reason: "Verified successfully",
  };
}

export async function verifyBatch(
  candidates: AcademicCandidate[],
  maxConcurrency: number = 5,
  yearStart: number = 2020,
  yearEnd: number = 2025
): Promise<AcademicCandidate[]> {
  console.log(`[LinkVerifierAgent] Verifying ${candidates.length} candidates (years ${yearStart}-${yearEnd})...`);
  
  const verified: AcademicCandidate[] = [];
  const failed: { title: string; reason: string }[] = [];

  for (let i = 0; i < candidates.length; i += maxConcurrency) {
    const batch = candidates.slice(i, i + maxConcurrency);
    
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const result = await verifyCandidate(candidate, yearStart, yearEnd);
        return { candidate, result };
      })
    );

    for (const { candidate, result } of results) {
      if (result.verified) {
        candidate.verified = true;
        candidate.verificationStatus = "verified";
        candidate.landingUrl = result.finalUrl || candidate.landingUrl;
        verified.push(candidate);
      } else {
        candidate.verificationStatus = "failed";
        failed.push({
          title: candidate.title.substring(0, 50),
          reason: result.reason,
        });
      }
    }

    if (i + maxConcurrency < candidates.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`[LinkVerifierAgent] Verified: ${verified.length}, Failed: ${failed.length}`);

  return verified;
}

export async function enrichMetadata(candidate: AcademicCandidate): Promise<AcademicCandidate> {
  if (!candidate.doi) return candidate;

  const metadata = await lookupDOI(candidate.doi);
  
  if (!metadata) return candidate;

  return {
    ...candidate,
    title: metadata.title || candidate.title,
    authors: metadata.authors.length > 0 ? metadata.authors : candidate.authors,
    year: metadata.year || candidate.year,
    journal: metadata.journal !== "Unknown" ? metadata.journal : candidate.journal,
    abstract: metadata.abstract || candidate.abstract,
    documentType: metadata.documentType || candidate.documentType,
    language: mapLanguageCode(metadata.language) || candidate.language,
    keywords: metadata.keywords.length > 0 ? metadata.keywords : candidate.keywords,
    citationCount: metadata.citationCount || candidate.citationCount,
    affiliations: metadata.affiliations.length > 0 ? metadata.affiliations : candidate.affiliations,
  };
}

function mapLanguageCode(code: string): string {
  const map: Record<string, string> = {
    "en": "English",
    "es": "Spanish",
    "pt": "Portuguese",
    "de": "German",
    "fr": "French",
    "it": "Italian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
  };
  return map[code?.toLowerCase()] || code || "English";
}

export async function enrichBatch(candidates: AcademicCandidate[]): Promise<AcademicCandidate[]> {
  console.log(`[MetadataAgent] Enriching ${candidates.length} candidates...`);
  
  const enriched: AcademicCandidate[] = [];
  
  for (const candidate of candidates) {
    const result = await enrichMetadata(candidate);
    enriched.push(result);
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return enriched;
}

export interface CriticResult {
  passed: boolean;
  totalVerified: number;
  targetCount: number;
  duplicatesRemoved: number;
  issues: string[];
  blockers: string[];
}

export function runCriticGuard(
  candidates: AcademicCandidate[],
  targetCount: number = 50,
  yearStart: number = 2020,
  yearEnd: number = 2025
): CriticResult {
  console.log(`[CriticGuardAgent] Checking ${candidates.length} candidates against criteria...`);
  
  const issues: string[] = [];
  const blockers: string[] = [];

  const verified = candidates.filter(c => c.verificationStatus === "verified");
  if (verified.length < candidates.length) {
    issues.push(`${candidates.length - verified.length} candidates not verified`);
  }

  const seenDois = new Set<string>();
  const seenTitles = new Set<string>();
  const deduplicated: AcademicCandidate[] = [];
  let duplicatesRemoved = 0;

  for (const candidate of verified) {
    const doiKey = candidate.doi?.toLowerCase().trim() || "";
    const normalizedTitle = candidate.title.toLowerCase().replace(/[^\w]/g, "").substring(0, 50);
    const titleKey = normalizedTitle;
    
    if (doiKey && seenDois.has(doiKey)) {
      duplicatesRemoved++;
      continue;
    }
    if (seenTitles.has(titleKey)) {
      duplicatesRemoved++;
      continue;
    }
    
    if (doiKey) seenDois.add(doiKey);
    seenTitles.add(titleKey);
    deduplicated.push(candidate);
  }

  if (duplicatesRemoved > 0) {
    issues.push(`Removed ${duplicatesRemoved} duplicates`);
  }

  const inYearRange = deduplicated.filter(c => c.year >= yearStart && c.year <= yearEnd);
  if (inYearRange.length < deduplicated.length) {
    const outOfRange = deduplicated.length - inYearRange.length;
    issues.push(`${outOfRange} articles outside year range ${yearStart}-${yearEnd}`);
  }

  const withDoi = inYearRange.filter(c => c.doi && c.doi.length > 0);
  if (withDoi.length < inYearRange.length) {
    issues.push(`${inYearRange.length - withDoi.length} articles missing DOI`);
  }

  const withRelevance = withDoi.filter(c => c.relevanceScore >= RELEVANCE_THRESHOLD);
  if (withRelevance.length < withDoi.length) {
    issues.push(`${withDoi.length - withRelevance.length} articles below relevance threshold`);
  }

  const finalCount = withRelevance.length;
  const MIN_VERIFIED_THRESHOLD = 50;
  
  if (finalCount < MIN_VERIFIED_THRESHOLD) {
    blockers.push(`Only ${finalCount} verified articles (minimum required: ${MIN_VERIFIED_THRESHOLD})`);
  }

  const passed = blockers.length === 0;

  console.log(`[CriticGuardAgent] Result: ${passed ? "PASSED" : "BLOCKED"}`);
  console.log(`[CriticGuardAgent] Final count: ${finalCount}/${MIN_VERIFIED_THRESHOLD} (target: ${targetCount})`);
  
  if (issues.length > 0) {
    console.log(`[CriticGuardAgent] Issues: ${issues.join("; ")}`);
  }
  if (blockers.length > 0) {
    console.log(`[CriticGuardAgent] Blockers: ${blockers.join("; ")}`);
  }

  return {
    passed,
    totalVerified: finalCount,
    targetCount: MIN_VERIFIED_THRESHOLD,
    duplicatesRemoved,
    issues,
    blockers,
  };
}

export function deduplicateCandidates(candidates: AcademicCandidate[]): AcademicCandidate[] {
  const seenDois = new Set<string>();
  const seenTitles = new Set<string>();
  const result: AcademicCandidate[] = [];

  for (const candidate of candidates) {
    const doiKey = candidate.doi?.toLowerCase() || "";
    const titleKey = candidate.title.toLowerCase().replace(/[^\w]/g, "").substring(0, 50);
    
    if (doiKey && seenDois.has(doiKey)) continue;
    if (seenTitles.has(titleKey)) continue;
    
    if (doiKey) seenDois.add(doiKey);
    seenTitles.add(titleKey);
    result.push(candidate);
  }

  return result;
}
