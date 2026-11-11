import { z } from "zod";

// No coercion, defaults or removal of unknown fields: reject invalid output.
export const analysisSchema = z.strictObject({
  category: z.enum(["sales", "support", "billing", "unknown"]),
  priority: z.enum(["normal", "high"]),
  draft: z.string(),
  needs_review: z.boolean(),
});

export function validateAnalysis(value) {
  return analysisSchema.safeParse(value);
}
