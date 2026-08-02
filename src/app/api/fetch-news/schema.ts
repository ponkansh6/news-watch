import { z } from "zod/v4";
import { SOURCE_ID_TUPLE } from "@/lib/news/registry";

export const FetchNewsBodySchema = z.object({
  source: z.enum(SOURCE_ID_TUPLE).default("zenn"),
});

export type FetchNewsBody = z.infer<typeof FetchNewsBodySchema>;
