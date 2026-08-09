import { cookies } from "next/headers";
import { getScoredArticlesCached } from "@/lib/db";
import FetchButton from "./fetch-button";
import { NewsSection } from "@/components/news/news-section";
import { PageShell } from "@/components/layout/page-shell";
import { setSourceCookie } from "./actions";

export default async function Home(props: { searchParams: Promise<{ source?: string }> }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const savedSource = cookieStore.get("source")?.value;
  const selectedSource = searchParams.source ?? savedSource ?? "zenn";

  // NOTE: RSC レンダリング中は cookie を書き込まない（Next.js の制約）。
  // cookie 書き込みは Server Action (./actions.ts) 経由でのみ行う。
  const scored = await getScoredArticlesCached(100, selectedSource);

  return (
    <PageShell>
      <section>
        <FetchButton selectedSource={selectedSource} onSourceChange={setSourceCookie} />
      </section>

      <section>
        <NewsSection articles={scored} />
      </section>
    </PageShell>
  );
}
