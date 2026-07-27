import { getScoredArticles } from "@/lib/db/actions";
import FetchButton from "./fetch-button";
import NewsSection from "./news-section";

export const dynamic = "force-dynamic";

export default async function Home(props: { searchParams: Promise<{ source?: string }> }) {
  const searchParams = await props.searchParams;
  const selectedSource = searchParams.source ?? "zenn";
  const scored = await getScoredArticles(100, selectedSource);

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
