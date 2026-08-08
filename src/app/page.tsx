import { getScoredArticlesCached } from "@/lib/db";
import FetchButton from "./fetch-button";
import { NewsSection } from "@/components/news/news-section";
import { PageShell } from "@/components/layout/page-shell";

export default async function Home(props: { searchParams: Promise<{ source?: string }> }) {
  const searchParams = await props.searchParams;
  const selectedSource = searchParams.source ?? "zenn";
  const scored = await getScoredArticlesCached(100, selectedSource);

  return (
    <PageShell title="News Watch">
      <section>
        <FetchButton />
      </section>

      <section>
        <NewsSection articles={scored} />
      </section>
    </PageShell>
  );
}
