import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export interface RdfItemRaw {
  title?: unknown;
  link?: unknown;
  description?: unknown;
  "dc:date"?: unknown;
  "dc:creator"?: unknown;
  "@_rdf:about"?: unknown;
  [key: string]: unknown;
}

export interface StandardRdfItem {
  title: string;
  link: string;
  description?: string;
  date?: string;
  creator?: string;
  about?: string;
}

export function parseRdf(xml: string): StandardRdfItem[] {
  const parsed = parser.parse(xml);
  const root = parsed["rdf:RDF"];
  if (!root?.item) return [];
  const items: RdfItemRaw[] = Array.isArray(root.item) ? root.item : [root.item];
  return items.map((i) => ({
    title: String(i.title ?? ""),
    link: String(i.link ?? ""),
    description: typeof i.description === "string" ? i.description : undefined,
    date: typeof i["dc:date"] === "string" ? i["dc:date"] : undefined,
    creator: typeof i["dc:creator"] === "string" ? i["dc:creator"] : undefined,
    about: typeof i["@_rdf:about"] === "string" ? i["@_rdf:about"] : undefined,
  }));
}
