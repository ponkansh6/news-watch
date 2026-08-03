import { z } from "zod/v4";

export const AnalyzeFavoritesBodySchema = z.object({ force: z.boolean().optional() }).optional();

export type AnalyzeFavoritesBody = z.infer<typeof AnalyzeFavoritesBodySchema>;
