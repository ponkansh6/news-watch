import { z } from "zod/v4";

export const NotForMeToggleBodySchema = z.object({
  articleId: z.number(),
});

export type NotForMeToggleBody = z.infer<typeof NotForMeToggleBodySchema>;
