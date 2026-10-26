import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

type TogglePayload = { articleId: number };

type ToggleRouteOptions<T extends TogglePayload> = {
  schema: ZodType<T>;
  toggle: (articleId: number) => Promise<boolean>;
  cacheTag: string;
  responseKey: string;
  errorLogPrefix: string;
};

export function createToggleRouteHandler<T extends TogglePayload>({
  schema,
  toggle,
  cacheTag,
  responseKey,
  errorLogPrefix,
}: ToggleRouteOptions<T>) {
  return async function handleToggle(request: Request) {
    try {
      const body = await request.json();
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid articleId" }, { status: 400 });
      }

      const toggled = await toggle(parsed.data.articleId);
      revalidateTag(cacheTag, "max");
      return NextResponse.json({ [responseKey]: toggled });
    } catch (err) {
      console.error(errorLogPrefix, err);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  };
}
