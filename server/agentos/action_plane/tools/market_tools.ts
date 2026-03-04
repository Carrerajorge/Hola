import { z } from "zod";

// #92 Galería de Plantillas
export const TemplateGalleryTool = {
  name: "list_templates",
  description: "List available agent templates (prompts)",
  schema: z.object({
    category: z.string().optional()
  }),
  riskLevel: "low" as const,
  handler: async (params: any) => {
    return [
        { id: "writer", name: "Copywriter Pro", description: "Expert in SEO blog posts" },
        { id: "coder", name: "Senior Dev", description: "Python/TS expert" },
        { id: "analyst", name: "Data Scientist", description: "Python pandas expert" }
    ];
  }
};

// #97 Analíticas
export const UsageStatsTool = {
  name: "get_my_stats",
  description: "Get user usage statistics (ROI)",
  schema: z.object({ period: z.enum(["day", "week", "month"]).default("month") }),
  riskLevel: "low" as const,
  handler: async (params: any) => {
    return {
        messages_sent: 1450,
        hours_saved: 12.5,
        money_saved_vs_human: "$450.00",
        top_skills: ["image_generation", "code_review"]
    };
  }
};
