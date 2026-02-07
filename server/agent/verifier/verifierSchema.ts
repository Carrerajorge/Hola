import { z } from "zod";

export const VerifierIssueSchema = z.object({
  issue: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  evidence: z.array(z.string()).default([]),
});

export const VerifierResultSchema = z.object({
  is_coherent: z.boolean(),
  confidence: z.number().min(0).max(1),

  contradictions: z.array(z.string()).default([]),
  missing_citations: z.array(z.string()).default([]),
  issues: z.array(VerifierIssueSchema).default([]),

  should_ask_clarifying_question: z.boolean().default(false),
  clarifying_question: z.string().optional(),

  notes: z.array(z.string()).default([]),
});

export type VerifierResult = z.infer<typeof VerifierResultSchema>;

