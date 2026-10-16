import { z } from "zod/v4";

// Unknown fields (including legacy `force`) are stripped, so clients cannot bypass cooldown.
export const AnalyzeFavoritesBodySchema = z.object({}).optional();

export type AnalyzeFavoritesBody = z.infer<typeof AnalyzeFavoritesBodySchema>;
