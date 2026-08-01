import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export function parseRss2<T>(xml: string): T[] {
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel?.item) return [];
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];
  return items as T[];
}
