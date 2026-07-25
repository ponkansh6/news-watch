import { getScoredArticles } from "@/lib/db/actions";
import FetchButton from "./fetch-button";
import NewsSection from "./news-section";

export const dynamic = "force-dynamic";

export default async function Home(props: { searchParams: Promise<{ sources?: string }> }) {
  const searchParams = await props.searchParams;
  const selectedSources = searchParams.sources?.split(",").filter(Boolean) ?? [];
  const scored = await getScoredArticles(
    100,
    selectedSources.length > 0 ? selectedSources : undefined,
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">News Watch</h1>
      </header>

      <section className="mb-12">
        <FetchButton />
      </section>

      <section className="mb-12">
        <NewsSection articles={scored} />
      </section>
    </main>
  );
}
