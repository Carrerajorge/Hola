import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const BriefSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

const DeliverableFormatSchema = z.enum([
  "plain_text",
  "markdown",
  "json",
  "csv",
  "code",
  "docx",
  "xlsx",
  "pptx",
  "pdf",
]);

const BriefInputItemSchema = z.object({
  item: z.string().min(1),
  source: z.string().min(1), // e.g. "message", "doc:foo.pdf p3", "img:123", "web:https://..."
});

export const CanonicalBriefSchema = z.object({
  brief_version: z.literal("1.0"),

  // Intention & plan
  primary_intent: z.string().min(1),
  subtasks: z.array(BriefSubtaskSchema).min(2).max(5),

  // Output contract
  deliverable: z.object({
    exact: z.string().min(1),
    format: DeliverableFormatSchema,
  }),

  // Audience/tone
  audience_tone: z.object({
    audience: z.string().min(1),
    tone: z.string().min(1),
    language: z.string().min(2).max(12),
  }),

  // Constraints & assumptions
  restrictions: z.array(z.string().min(1)).default([]),
  inputs: z.object({
    provided: z.array(BriefInputItemSchema).default([]),
    assumed: z.array(z.string().min(1)).default([]),
  }),

  // Success and risk
  success_criteria: z.array(z.string().min(1)).default([]),
  risks_ambiguities: z.array(z.object({
    issue: z.string().min(1),
    why_it_matters: z.string().min(1).optional(),
    mitigation: z.string().min(1).optional(),
  })).default([]),

  // If blocked, ask exactly ONE clarifying question, otherwise null.
  blocker: z.object({
    is_blocked: z.boolean(),
    clarification_question: z.string().min(1).nullable(),
  }),
}).superRefine((val, ctx) => {
  if (val.blocker.is_blocked && !val.blocker.clarification_question) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blocker", "clarification_question"],
      message: "clarification_question must be a non-empty string when is_blocked=true",
    });
  }
  if (!val.blocker.is_blocked && val.blocker.clarification_question !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["blocker", "clarification_question"],
      message: "clarification_question must be null when is_blocked=false",
    });
  }
});

export type CanonicalBrief = z.infer<typeof CanonicalBriefSchema>;

export const CanonicalBriefJsonSchema = zodToJsonSchema(CanonicalBriefSchema, {
  name: "CanonicalBrief",
});

