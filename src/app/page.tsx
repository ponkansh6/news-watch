"use server";

import { cookies } from "next/headers";
import { getScoredArticlesCached } from "@/lib/db";
import FetchButton from "./fetch-button";
import { NewsSection } from "@/components/news/news-section";
import { PageShell } from "@/components/layout/page-shell";

async function setSourceCookie(source: string) {
  const cookieStore = await cookies();
  cookieStore.set("source", source, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}

async function handleSourceChange(source: string) {
  await setSourceCookie(source);
  // Note: Server Actions don't return to component, so we use the source
  // param directly in the client-side router.push below
}

export default async function Home(props: { searchParams: Promise<{ source?: string }> }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const savedSource = cookieStore.get("source")?.value;
  const selectedSource = searchParams.source ?? savedSource ?? "zenn";

  // Update cookie if URL param differs from saved cookie
  if (selectedSource !== savedSource) {
    await setSourceCookie(selectedSource);
  }

  const scored = await getScoredArticlesCached(100, selectedSource);

  return (
    <PageShell title="News Watch">
      <section>
        <FetchButton selectedSource={selectedSource} onSourceChange={handleSourceChange} />
      </section>

      <section>
        <NewsSection articles={scored} />
      </section>
    </PageShell>
  );
}
