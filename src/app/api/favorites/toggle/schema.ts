import { z } from "zod/v4";

export const ToggleFavoriteBodySchema = z.object({
  articleId: z.number(),
});

export type ToggleFavoriteBody = z.infer<typeof ToggleFavoriteBodySchema>;
