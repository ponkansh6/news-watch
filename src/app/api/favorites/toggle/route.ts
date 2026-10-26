import { toggleFavorite } from "@/lib/db";
import { createToggleRouteHandler } from "@/lib/api/create-toggle-route-handler";
import { ToggleFavoriteBodySchema } from "./schema";

const handleToggle = createToggleRouteHandler({
  schema: ToggleFavoriteBodySchema,
  toggle: toggleFavorite,
  cacheTag: "favorites",
  responseKey: "favorited",
  errorLogPrefix: "[api] favorites/toggle error:",
});

export async function POST(request: Request) {
  return handleToggle(request);
}
