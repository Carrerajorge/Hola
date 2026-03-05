const z = require('zod');
const webSearchSchema = z.object({
  query: z.string().describe("The search query"),
  maxResults: z.number().min(1).max(20).default(5).describe("Maximum number of results to return"),
  academic: z.boolean().default(false).describe("Whether to search academic/scholarly sources"),
});

try {
  webSearchSchema.parse({});
} catch (err) {
  console.log(err.message);
}
