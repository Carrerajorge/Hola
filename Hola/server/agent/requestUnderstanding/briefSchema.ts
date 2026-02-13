import { z } from "zod";

export const BriefIntentSchema = z.object({
  primary_intent: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const BriefSubTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

export const BriefDeliverableSchema = z.object({
  description: z.string().min(1),
  format: z.string().min(1),
});

export const BriefAudienceSchema = z.object({
  audience: z.string().min(1).default("general"),
  tone: z.string().min(1).default("direct"),
  language: z.string().min(1).default("es"),
});

export const BriefConstraintSchema = z.object({
  constraint: z.string().min(1),
  hard: z.boolean().default(true),
});

export const BriefDataPointSchema = z.object({
  key: z.string().default("unknown"),
  value: z.any(),
  source: z.enum(["provided", "extracted", "assumed"]).default("provided"),
});

export const BriefRiskSchema = z.object({
  risk: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export const RequestBriefSchema = z.object({
  intent: BriefIntentSchema,

  // 2–5 subtasks required by spec
  subtasks: z.array(BriefSubTaskSchema).min(2).max(5),

  deliverable: BriefDeliverableSchema,
  audience: BriefAudienceSchema,

  restrictions: z.array(BriefConstraintSchema).default([]),

  data_provided: z.array(BriefDataPointSchema).default([]),
  assumptions: z.array(z.string()).default([]),

  success_criteria: z.array(z.string()).default([]),

  risks: z.array(BriefRiskSchema).default([]),
  ambiguities: z.array(z.string()).default([]),

  blocker: z
    .object({
      is_blocked: z.boolean().default(false),
      question: z.string().optional(),
    })
    .default({ is_blocked: false }),
});

export type RequestBrief = z.infer<typeof RequestBriefSchema>;
