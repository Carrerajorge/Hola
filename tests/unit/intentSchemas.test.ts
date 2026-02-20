import { describe, it, expect } from "vitest";
import {
  ROUTER_VERSION,
  IntentTypeSchema,
  OutputFormatSchema,
  LengthSchema,
  SlotsSchema,
  SingleIntentResultSchema,
  PlanStepSchema,
  MultiIntentResultSchema,
  CompoundPlanStepSchema,
  CompoundPlanSchema,
  IntentResultSchema,
  UnifiedIntentResultSchema,
  StepConstraintsSchema,
  PlanConstraintsSchema,
  FullPlanStepSchema,
  ExecutionPlanSchema,
  DEFAULT_CALIBRATION,
  SupportedLocales,
} from "@shared/schemas/intent";

// ---------------------------------------------------------------------------
// IntentTypeSchema
// ---------------------------------------------------------------------------
describe("IntentTypeSchema", () => {
  it("accepts every valid intent type", () => {
    const validTypes = [
      "CREATE_PRESENTATION", "CREATE_DOCUMENT", "CREATE_SPREADSHEET",
      "SUMMARIZE", "TRANSLATE", "SEARCH_WEB", "ANALYZE_DOCUMENT",
      "CHAT_GENERAL", "NEED_CLARIFICATION",
    ];
    for (const t of validTypes) {
      expect(IntentTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown intent types", () => {
    expect(() => IntentTypeSchema.parse("DELETE_ALL")).toThrow();
    expect(() => IntentTypeSchema.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OutputFormatSchema
// ---------------------------------------------------------------------------
describe("OutputFormatSchema", () => {
  it("accepts all valid output formats", () => {
    for (const fmt of ["pptx", "docx", "xlsx", "pdf", "txt", "csv", "html"]) {
      expect(OutputFormatSchema.parse(fmt)).toBe(fmt);
    }
  });

  it("accepts null (nullable schema)", () => {
    expect(OutputFormatSchema.parse(null)).toBeNull();
  });

  it("rejects invalid formats", () => {
    expect(() => OutputFormatSchema.parse("mp4")).toThrow();
    expect(() => OutputFormatSchema.parse(42)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LengthSchema
// ---------------------------------------------------------------------------
describe("LengthSchema", () => {
  it("accepts short, medium, long and null", () => {
    expect(LengthSchema.parse("short")).toBe("short");
    expect(LengthSchema.parse("medium")).toBe("medium");
    expect(LengthSchema.parse("long")).toBe("long");
    expect(LengthSchema.parse(null)).toBeNull();
  });

  it("rejects invalid length values", () => {
    expect(() => LengthSchema.parse("extra-long")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SlotsSchema
// ---------------------------------------------------------------------------
describe("SlotsSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const result = SlotsSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts a fully populated slots object", () => {
    const slots = {
      topic: "AI Ethics",
      title: "Intro to AI",
      language: "en",
      length: "medium",
      audience: "executives",
      style: "formal",
      bullet_points: true,
      include_images: false,
      source_language: "en",
      target_language: "es",
      num_slides: 10,
      template: "corporate",
      file_paths: ["/tmp/a.pdf", "/tmp/b.docx"],
      validation_issues: ["missing title"],
      page_numbers: [1, 3, 5],
      page_range: { start: 1, end: 10 },
      section_number: 2,
      scope: "partial",
    };
    const result = SlotsSchema.parse(slots);
    expect(result.topic).toBe("AI Ethics");
    expect(result.file_paths).toHaveLength(2);
    expect(result.page_range?.end).toBe(10);
    expect(result.scope).toBe("partial");
  });

  it("rejects invalid scope enum value", () => {
    expect(() => SlotsSchema.parse({ scope: "random" })).toThrow();
  });

  it("rejects non-number num_slides", () => {
    expect(() => SlotsSchema.parse({ num_slides: "ten" })).toThrow();
  });

  it("accepts null length inside slots", () => {
    const result = SlotsSchema.parse({ length: null });
    expect(result.length).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SingleIntentResultSchema
// ---------------------------------------------------------------------------
describe("SingleIntentResultSchema", () => {
  const minimalValid = {
    intent: "SUMMARIZE",
    output_format: null,
    slots: {},
    confidence: 0.9,
    normalized_text: "Summarize this document",
  };

  it("accepts a minimal valid single intent result", () => {
    const result = SingleIntentResultSchema.parse(minimalValid);
    expect(result.intent).toBe("SUMMARIZE");
    expect(result.confidence).toBe(0.9);
  });

  it("accepts all optional fields", () => {
    const full = {
      ...minimalValid,
      raw_confidence: 0.85,
      clarification_question: "Which document?",
      matched_patterns: ["pattern_a"],
      reasoning: "keyword match",
      fallback_used: "knn",
      language_detected: "en",
    };
    const result = SingleIntentResultSchema.parse(full);
    expect(result.fallback_used).toBe("knn");
    expect(result.matched_patterns).toHaveLength(1);
  });

  it("rejects confidence below 0", () => {
    expect(() =>
      SingleIntentResultSchema.parse({ ...minimalValid, confidence: -0.1 })
    ).toThrow();
  });

  it("rejects confidence above 1", () => {
    expect(() =>
      SingleIntentResultSchema.parse({ ...minimalValid, confidence: 1.5 })
    ).toThrow();
  });

  it("rejects invalid fallback_used enum", () => {
    expect(() =>
      SingleIntentResultSchema.parse({ ...minimalValid, fallback_used: "regex" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PlanStepSchema
// ---------------------------------------------------------------------------
describe("PlanStepSchema", () => {
  it("accepts a valid plan step", () => {
    const step = {
      step_id: 1,
      intent: "CREATE_DOCUMENT",
      output_format: "docx",
      slots: { topic: "Sales Report" },
    };
    const result = PlanStepSchema.parse(step);
    expect(result.step_id).toBe(1);
    expect(result.depends_on).toBeUndefined();
  });

  it("accepts depends_on array", () => {
    const step = {
      step_id: 2,
      intent: "TRANSLATE",
      output_format: null,
      slots: {},
      depends_on: [1],
    };
    const result = PlanStepSchema.parse(step);
    expect(result.depends_on).toEqual([1]);
  });

  it("rejects missing step_id", () => {
    expect(() =>
      PlanStepSchema.parse({ intent: "SUMMARIZE", output_format: null, slots: {} })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MultiIntentResultSchema
// ---------------------------------------------------------------------------
describe("MultiIntentResultSchema", () => {
  const minimalSingle = {
    intent: "SUMMARIZE",
    output_format: null,
    slots: {},
    confidence: 0.8,
    normalized_text: "sum",
  };

  it("accepts a valid multi-intent result", () => {
    const data = {
      type: "multi",
      intents: [minimalSingle],
      aggregated_confidence: 0.8,
      normalized_text: "multi task",
      router_version: "2.0.0",
    };
    const result = MultiIntentResultSchema.parse(data);
    expect(result.type).toBe("multi");
    expect(result.intents).toHaveLength(1);
  });

  it("accepts optional plan, processing_time_ms, cache_hit", () => {
    const data = {
      type: "multi",
      intents: [minimalSingle],
      plan: {
        steps: [{ step_id: 1, intent: "SUMMARIZE", output_format: null, slots: {} }],
        execution_order: [1],
      },
      aggregated_confidence: 0.75,
      normalized_text: "plan",
      router_version: "2.0.0",
      processing_time_ms: 120,
      cache_hit: false,
    };
    const result = MultiIntentResultSchema.parse(data);
    expect(result.plan?.steps).toHaveLength(1);
    expect(result.processing_time_ms).toBe(120);
  });

  it("rejects type other than 'multi'", () => {
    expect(() =>
      MultiIntentResultSchema.parse({
        type: "single",
        intents: [],
        aggregated_confidence: 0.5,
        normalized_text: "",
        router_version: "1.0",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CompoundPlanStepSchema + CompoundPlanSchema
// ---------------------------------------------------------------------------
describe("CompoundPlanStepSchema", () => {
  it("accepts every valid step type", () => {
    const types = ["WEB_RESEARCH", "EVIDENCE_BUILD", "OUTLINE", "DRAFT_SECTIONS", "FACT_VERIFY", "RENDER_DOCX"];
    for (const t of types) {
      expect(CompoundPlanStepSchema.parse({ type: t }).type).toBe(t);
    }
  });

  it("accepts optional fields", () => {
    const step = {
      type: "WEB_RESEARCH",
      query: "AI trends 2025",
      min_sources: 5,
      dedupe: true,
    };
    const result = CompoundPlanStepSchema.parse(step);
    expect(result.min_sources).toBe(5);
  });

  it("rejects unknown step type", () => {
    expect(() => CompoundPlanStepSchema.parse({ type: "UNKNOWN" })).toThrow();
  });
});

describe("CompoundPlanSchema", () => {
  it("accepts a complete compound plan", () => {
    const plan = {
      isCompound: true,
      intent: "CREATE_DOCUMENT",
      doc_type: "report",
      output_format: "docx",
      topic: "AI Ethics",
      requires_research: true,
      plan: {
        id: "plan-1",
        steps: [{ type: "WEB_RESEARCH", query: "AI ethics" }],
      },
      confidence: 0.95,
      locale: "en",
    };
    const result = CompoundPlanSchema.parse(plan);
    expect(result.isCompound).toBe(true);
    expect(result.plan?.steps).toHaveLength(1);
  });

  it("accepts null for nullable fields (doc_type, output_format, topic, plan)", () => {
    const plan = {
      isCompound: false,
      intent: "CHAT_GENERAL",
      doc_type: null,
      output_format: null,
      topic: null,
      requires_research: false,
      plan: null,
      confidence: 0.5,
      locale: "es",
    };
    const result = CompoundPlanSchema.parse(plan);
    expect(result.doc_type).toBeNull();
    expect(result.plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// IntentResultSchema (extended single)
// ---------------------------------------------------------------------------
describe("IntentResultSchema", () => {
  const base = {
    intent: "CHAT_GENERAL",
    output_format: null,
    slots: {},
    confidence: 0.6,
    normalized_text: "hello",
  };

  it("accepts base SingleIntentResult fields", () => {
    const result = IntentResultSchema.parse(base);
    expect(result.intent).toBe("CHAT_GENERAL");
  });

  it("accepts extended fields: type, router_version, compound_plan", () => {
    const extended = {
      ...base,
      type: "single",
      router_version: "2.0.0",
      processing_time_ms: 42,
      cache_hit: true,
      compound_plan: {
        isCompound: false,
        intent: "CHAT_GENERAL",
        doc_type: null,
        output_format: null,
        topic: null,
        requires_research: false,
        plan: null,
        confidence: 0.6,
        locale: "en",
      },
    };
    const result = IntentResultSchema.parse(extended);
    expect(result.type).toBe("single");
    expect(result.compound_plan?.isCompound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UnifiedIntentResultSchema (union)
// ---------------------------------------------------------------------------
describe("UnifiedIntentResultSchema", () => {
  it("accepts a single intent result", () => {
    const single = {
      intent: "TRANSLATE",
      output_format: "txt",
      slots: { source_language: "en", target_language: "fr" },
      confidence: 0.95,
      normalized_text: "translate doc",
    };
    const result = UnifiedIntentResultSchema.parse(single);
    expect(result.confidence).toBe(0.95);
  });

  it("accepts a multi intent result", () => {
    const multi = {
      type: "multi",
      intents: [
        { intent: "SUMMARIZE", output_format: null, slots: {}, confidence: 0.7, normalized_text: "s" },
      ],
      aggregated_confidence: 0.7,
      normalized_text: "do stuff",
      router_version: "2.0.0",
    };
    const result = UnifiedIntentResultSchema.parse(multi);
    expect((result as any).type).toBe("multi");
  });

  it("rejects completely invalid data", () => {
    expect(() => UnifiedIntentResultSchema.parse({ random: true })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// StepConstraintsSchema + PlanConstraintsSchema
// ---------------------------------------------------------------------------
describe("StepConstraintsSchema", () => {
  it("accepts valid step constraints", () => {
    const data = {
      max_output_size: 50000,
      allowed_formats: ["docx", "pdf"],
      timeout_ms: 30000,
    };
    const result = StepConstraintsSchema.parse(data);
    expect(result.allowed_formats).toHaveLength(2);
  });

  it("accepts optional requires_document_source and requires_web_source", () => {
    const data = {
      max_output_size: 100,
      allowed_formats: [null],
      timeout_ms: 5000,
      requires_document_source: true,
      requires_web_source: false,
    };
    const result = StepConstraintsSchema.parse(data);
    expect(result.requires_document_source).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(() => StepConstraintsSchema.parse({ max_output_size: 1 })).toThrow();
  });
});

describe("PlanConstraintsSchema", () => {
  it("accepts valid plan constraints", () => {
    const data = {
      max_total_duration_ms: 60000,
      max_parallel_steps: 3,
      allow_partial_failure: true,
    };
    const result = PlanConstraintsSchema.parse(data);
    expect(result.allow_partial_failure).toBe(true);
  });

  it("rejects missing allow_partial_failure", () => {
    expect(() =>
      PlanConstraintsSchema.parse({ max_total_duration_ms: 1000, max_parallel_steps: 1 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FullPlanStepSchema + ExecutionPlanSchema
// ---------------------------------------------------------------------------
describe("FullPlanStepSchema", () => {
  it("accepts a valid full plan step", () => {
    const step = {
      id: "step-1",
      intent: "CREATE_DOCUMENT",
      slots: { topic: "Climate" },
      output_format: "docx",
      constraints: {
        max_output_size: 10000,
        allowed_formats: ["docx"],
        timeout_ms: 30000,
      },
      depends_on: [],
    };
    const result = FullPlanStepSchema.parse(step);
    expect(result.id).toBe("step-1");
    expect(result.depends_on).toHaveLength(0);
  });

  it("accepts optional inherits_from", () => {
    const step = {
      id: "step-2",
      intent: "SUMMARIZE",
      slots: {},
      output_format: null,
      constraints: {
        max_output_size: 5000,
        allowed_formats: [null],
        timeout_ms: 10000,
      },
      depends_on: ["step-1"],
      inherits_from: "step-1",
    };
    const result = FullPlanStepSchema.parse(step);
    expect(result.inherits_from).toBe("step-1");
  });
});

describe("ExecutionPlanSchema", () => {
  it("accepts a complete execution plan", () => {
    const plan = {
      id: "exec-plan-1",
      steps: [
        {
          id: "s1",
          intent: "CREATE_DOCUMENT",
          slots: {},
          output_format: "docx",
          constraints: {
            max_output_size: 50000,
            allowed_formats: ["docx"],
            timeout_ms: 30000,
          },
          depends_on: [],
        },
      ],
      execution_order: [["s1"]],
      estimated_duration_ms: 30000,
      constraints: {
        max_total_duration_ms: 120000,
        max_parallel_steps: 2,
        allow_partial_failure: false,
      },
      is_valid: true,
      validation_errors: [],
    };
    const result = ExecutionPlanSchema.parse(plan);
    expect(result.is_valid).toBe(true);
    expect(result.validation_errors).toHaveLength(0);
  });

  it("rejects when is_valid is missing", () => {
    expect(() =>
      ExecutionPlanSchema.parse({
        id: "x",
        steps: [],
        execution_order: [],
        estimated_duration_ms: 0,
        constraints: { max_total_duration_ms: 0, max_parallel_steps: 0, allow_partial_failure: false },
        validation_errors: [],
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Constants / Exports
// ---------------------------------------------------------------------------
describe("Exported constants", () => {
  it("ROUTER_VERSION is a semver-like string", () => {
    expect(ROUTER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("SupportedLocales contains expected locales", () => {
    expect(SupportedLocales).toContain("es");
    expect(SupportedLocales).toContain("en");
    expect(SupportedLocales).toContain("ja");
    expect(SupportedLocales.length).toBeGreaterThan(10);
  });

  it("DEFAULT_CALIBRATION has expected shape and ranges", () => {
    expect(DEFAULT_CALIBRATION.temperature).toBe(1.0);
    expect(DEFAULT_CALIBRATION.rule_weight + DEFAULT_CALIBRATION.knn_weight).toBe(1.0);
    expect(DEFAULT_CALIBRATION.min_threshold).toBeGreaterThan(0);
    expect(DEFAULT_CALIBRATION.fallback_threshold).toBeGreaterThan(DEFAULT_CALIBRATION.min_threshold);
    expect(DEFAULT_CALIBRATION.isotonic_bins).toHaveLength(7);
    expect(DEFAULT_CALIBRATION.isotonic_values).toHaveLength(7);
  });
});
