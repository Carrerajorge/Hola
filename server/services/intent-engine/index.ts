import {
  ROUTER_VERSION,
  DEFAULT_CALIBRATION,
  type IntentResult,
  type MultiIntentResult,
  type UnifiedIntentResult,
  type IntentType,
  type SupportedLocale,
  IntentResultSchema
} from "../../../shared/schemas/intent";
import { preprocess, type PreprocessResult } from "./preprocess";
import { detectLanguage, isCodeSwitching, type LanguageDetectionResult } from "./langDetect";
import { ruleBasedMatch, extractSlots, type RuleMatchResult } from "./ruleMatcher";
import { knnMatch, type KNNResult } from "./embeddingMatcher";
import { calibrate, type CalibrationOutput } from "./confidenceCalibrator";
import { llmFallback, getCircuitBreakerStats } from "./fallbackManager";
import { getCached, setCached, getCacheStats, invalidateCache } from "./cache";
import {
  startTrace,
  endTrace,
  recordError,
  recordDegradedFallback,
  getMetricsSnapshot,
  logStructured
} from "./telemetry";
import {
  detectMultiIntent,
  buildExecutionPlan,
  generateDisambiguationQuestion,
  mergeSlots
} from "./multiIntent";

export interface RouterConfig {
  enableCache: boolean;
  enableKNN: boolean;
  enableLLMFallback: boolean;
  enableMultiIntent: boolean;
  fallbackThreshold: number;
  maxRetries: number;
  timeout: number;
}

const DEFAULT_CONFIG: RouterConfig = {
  enableCache: true,
  enableKNN: true,
  enableLLMFallback: true,
  enableMultiIntent: true,
  fallbackThreshold: 0.80,
  maxRetries: 2,
  timeout: 15000
};

let currentConfig: RouterConfig = { ...DEFAULT_CONFIG };

export function configure(config: Partial<RouterConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  logStructured("info", "Router configuration updated", { config: currentConfig });
}

export function getConfig(): RouterConfig {
  return { ...currentConfig };
}

function generateClarificationQuestion(
  ruleResult: RuleMatchResult,
  locale: SupportedLocale
): string {
  const questions: Record<SupportedLocale, Record<string, string>> = {
    es: {
      format: "¿En qué formato lo quieres? (PowerPoint, Word o Excel)",
      topic: "¿Sobre qué tema te gustaría que trate?",
      general: "¿Podrías darme más detalles sobre lo que necesitas?"
    },
    en: {
      format: "What format would you like? (PowerPoint, Word, or Excel)",
      topic: "What topic would you like it to be about?",
      general: "Could you give me more details about what you need?"
    },
    pt: {
      format: "Em que formato você quer? (PowerPoint, Word ou Excel)",
      topic: "Sobre qual tema você gostaria que fosse?",
      general: "Você poderia me dar mais detalhes sobre o que precisa?"
    },
    fr: {
      format: "Quel format souhaitez-vous ? (PowerPoint, Word ou Excel)",
      topic: "Quel sujet aimeriez-vous aborder ?",
      general: "Pourriez-vous me donner plus de détails sur ce dont vous avez besoin ?"
    },
    de: {
      format: "Welches Format möchten Sie? (PowerPoint, Word oder Excel)",
      topic: "Über welches Thema soll es gehen?",
      general: "Könnten Sie mir mehr Details geben, was Sie brauchen?"
    },
    it: {
      format: "Quale formato preferisci? (PowerPoint, Word o Excel)",
      topic: "Su quale argomento vorresti che fosse?",
      general: "Potresti darmi più dettagli su cosa ti serve?"
    }
  };

  const localeQuestions = questions[locale] || questions.en;

  if (ruleResult.has_creation_verb && !ruleResult.output_format) {
    return localeQuestions.format;
  }

  return localeQuestions.general;
}

export async function routeIntent(
  text: string,
  config: Partial<RouterConfig> = {}
): Promise<IntentResult> {
  const effectiveConfig = { ...currentConfig, ...config };
  const startTime = Date.now();
  const ctx = startTrace("routeIntent", { text_length: text.length });

  try {
    const langResult = detectLanguage(text);
    const locale = langResult.locale;

    logStructured("info", "Language detected", {
      locale,
      confidence: langResult.confidence,
      method: langResult.method,
      is_code_switching: isCodeSwitching(text)
    });

    const preprocessResult = preprocess(text, locale);
    const { normalized } = preprocessResult;

    logStructured("info", "Text preprocessed", {
      original_length: text.length,
      normalized_length: normalized.length,
      typos_corrected: preprocessResult.typos_corrected.length,
      urls_removed: preprocessResult.removed_urls.length,
      emojis_removed: preprocessResult.removed_emojis.length
    });

    if (effectiveConfig.enableCache) {
      const cached = getCached(normalized, ROUTER_VERSION);
      if (cached) {
        logStructured("info", "Cache hit", { normalized_text: normalized.substring(0, 50) });
        
        const result: IntentResult = {
          ...cached,
          processing_time_ms: Date.now() - startTime,
          cache_hit: true,
          router_version: ROUTER_VERSION
        };
        
        endTrace(ctx, result, true);
        return result;
      }
    }

    if (effectiveConfig.enableMultiIntent) {
      const multiResult = detectMultiIntent(normalized);
      if (multiResult.isMultiIntent && multiResult.detectedIntents.length > 1) {
        logStructured("info", "Multi-intent detected", {
          intents: multiResult.detectedIntents,
          separator: multiResult.separatorType
        });
      }
    }

    const ruleResult = ruleBasedMatch(normalized, locale);

    logStructured("info", "Rule-based match complete", {
      intent: ruleResult.intent,
      confidence: ruleResult.confidence,
      raw_score: ruleResult.raw_score,
      patterns_matched: ruleResult.matched_patterns.length,
      has_creation_verb: ruleResult.has_creation_verb
    });

    let knnResult: KNNResult | null = null;
    if (effectiveConfig.enableKNN) {
      knnResult = knnMatch(text);
      
      logStructured("info", "KNN match complete", {
        intent: knnResult.intent,
        confidence: knnResult.confidence,
        top_match_similarity: knnResult.top_matches[0]?.similarity || 0
      });
    }

    const calibrationInput = {
      rule_confidence: ruleResult.confidence,
      knn_confidence: knnResult?.confidence || ruleResult.confidence,
      rule_patterns_matched: ruleResult.matched_patterns.length,
      has_creation_verb: ruleResult.has_creation_verb,
      text_length: text.length,
      language_confidence: langResult.confidence
    };

    const calibrated = calibrate(calibrationInput, DEFAULT_CALIBRATION);

    logStructured("info", "Confidence calibrated", {
      raw_combined: calibrated.raw_combined,
      calibrated: calibrated.calibrated_confidence,
      adjustment: calibrated.adjustment_applied,
      should_fallback: calibrated.should_fallback
    });

    let finalIntent = ruleResult.intent;
    let finalConfidence = calibrated.calibrated_confidence;
    let fallbackUsed: "none" | "knn" | "llm" = "none";
    let reasoning: string | undefined;
    let slots = extractSlots(normalized, text);

    if (knnResult && knnResult.confidence > ruleResult.confidence) {
      finalIntent = knnResult.intent;
      fallbackUsed = "knn";
    }

    if (calibrated.should_fallback && effectiveConfig.enableLLMFallback) {
      logStructured("info", "Triggering LLM fallback", {
        calibrated_confidence: calibrated.calibrated_confidence,
        threshold: effectiveConfig.fallbackThreshold
      });

      try {
        const llmResult = await llmFallback(
          normalized,
          text,
          effectiveConfig.maxRetries
        );

        if (llmResult.fallback_method === "llm") {
          finalIntent = llmResult.intent;
          finalConfidence = llmResult.confidence;
          slots = { ...slots, ...llmResult.slots };
          reasoning = llmResult.reasoning;
          fallbackUsed = "llm";

          logStructured("info", "LLM fallback successful", {
            intent: finalIntent,
            confidence: finalConfidence
          });
        } else {
          recordDegradedFallback();
          logStructured("warn", "Using degraded fallback", {
            intent: llmResult.intent,
            error: llmResult.error
          });
        }
      } catch (error) {
        recordError(error as Error, ctx);
        logStructured("error", "LLM fallback failed", {
          error: (error as Error).message
        });
      }
    }

    let clarificationQuestion: string | undefined;
    if (finalConfidence < 0.50 || finalIntent === "CHAT_GENERAL") {
      if (ruleResult.has_creation_verb && !ruleResult.output_format) {
        finalIntent = "NEED_CLARIFICATION";
        clarificationQuestion = generateClarificationQuestion(ruleResult, locale);
      }
    }

    const result: IntentResult = {
      intent: finalIntent,
      output_format: ruleResult.output_format,
      slots,
      confidence: finalConfidence,
      raw_confidence: calibrated.raw_combined,
      normalized_text: normalized,
      clarification_question: clarificationQuestion,
      matched_patterns: ruleResult.matched_patterns,
      reasoning,
      fallback_used: fallbackUsed,
      language_detected: locale,
      type: "single",
      router_version: ROUTER_VERSION,
      processing_time_ms: Date.now() - startTime,
      cache_hit: false
    };

    const validatedResult = IntentResultSchema.parse(result);

    if (effectiveConfig.enableCache) {
      setCached(normalized, ROUTER_VERSION, validatedResult);
    }

    endTrace(ctx, validatedResult, true);
    return validatedResult;

  } catch (error) {
    recordError(error as Error, ctx);
    
    logStructured("error", "Route intent failed", {
      error: (error as Error).message,
      text_length: text.length
    });

    const fallbackResult: IntentResult = {
      intent: "CHAT_GENERAL",
      output_format: null,
      slots: {},
      confidence: 0.30,
      normalized_text: text.toLowerCase(),
      fallback_used: "none",
      type: "single",
      router_version: ROUTER_VERSION,
      processing_time_ms: Date.now() - startTime,
      cache_hit: false
    };

    endTrace(ctx, fallbackResult, false);
    return fallbackResult;
  }
}

export {
  ROUTER_VERSION,
  getMetricsSnapshot,
  getCacheStats,
  invalidateCache,
  getCircuitBreakerStats,
  type IntentResult,
  type MultiIntentResult,
  type UnifiedIntentResult
};

export { preprocess } from "./preprocess";
export { detectLanguage, isCodeSwitching } from "./langDetect";
export { ruleBasedMatch, extractSlots } from "./ruleMatcher";
export { knnMatch } from "./embeddingMatcher";
export { calibrate, computeConfusionMatrix } from "./confidenceCalibrator";
export { llmFallback } from "./fallbackManager";
export { detectMultiIntent, buildExecutionPlan, generateDisambiguationQuestion } from "./multiIntent";
