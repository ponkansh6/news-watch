const referenceTimestamp = process.env.PLAN22_REFERENCE_TIMESTAMP;
if (!referenceTimestamp)
  throw new Error("PLAN22_REFERENCE_TIMESTAMP is required for the plan 22 fixture");

const referenceTimeMs = new Date(referenceTimestamp).getTime();
if (!Number.isFinite(referenceTimeMs))
  throw new Error("PLAN22_REFERENCE_TIMESTAMP must be a valid ISO timestamp");
const fixtureRelevance = Number(process.env.PLAN22_FIXTURE_B_RELEVANCE);
const fixtureUsefulness = Number(process.env.PLAN22_FIXTURE_B_USEFULNESS);
if (!Number.isFinite(fixtureRelevance) || !Number.isFinite(fixtureUsefulness)) {
  throw new Error("Plan 22 fixture relevance and usefulness scores are required");
}

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Plan 22 fixture</title><item>
<title>Plan22 fixture B</title><link>https://fixture.news-watch.invalid/articles/plan22-b</link>
<description>Deterministic article for the first refresh cache regression.</description>
<pubDate>${new Date(referenceTimeMs).toUTCString()}</pubDate><author>Plan 22</author>
</item></channel></rss>`;

const geminiResult = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          {
            text: JSON.stringify([
              {
                summary: "Fixture summary",
                usefulness: fixtureUsefulness,
                ntt_relevance: fixtureRelevance,
                reason: "Fixture reason",
              },
            ]),
          },
        ],
      },
      finishReason: "STOP",
      index: 0,
    },
  ],
};

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://yamadashy.github.io/tech-blog-rss-feed/feeds/rss.xml") {
    return new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }
  if (url.includes("generativelanguage.googleapis.com")) {
    return Response.json(geminiResult);
  }
  if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
    return originalFetch(input, init);
  }
  throw new Error(`Blocked unexpected outbound request in plan 22 smoke: ${url}`);
};
