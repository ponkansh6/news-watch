import { toggleNotForMe } from "@/lib/db";
import { createToggleRouteHandler } from "@/lib/api/create-toggle-route-handler";
import { NotForMeToggleBodySchema } from "./schema";

const handleToggle = createToggleRouteHandler({
  schema: NotForMeToggleBodySchema,
  toggle: toggleNotForMe,
  cacheTag: "not-for-me",
  responseKey: "notForMe",
  errorLogPrefix: "[api] not-for-me/toggle error:",
});

export async function POST(request: Request) {
  return handleToggle(request);
}
