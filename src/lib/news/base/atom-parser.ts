import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export function getText(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node)
    return String((node as Record<string, unknown>)["#text"]);
  return String(node ?? "");
}

export function parseAtomEntries(xml: string): Record<string, unknown>[] {
  const parsed = parser.parse(xml);
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}
