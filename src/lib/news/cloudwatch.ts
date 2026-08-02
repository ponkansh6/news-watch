import { createRdfSource, RDF_FEEDS } from "./feeds";
import { parseRdf, type StandardRdfItem } from "./base/rdf-parser";

export type CloudWatchItem = StandardRdfItem;

export function parseCloudWatchRss(xml: string): CloudWatchItem[] {
  return parseRdf(xml);
}

export const searchCloudWatch = createRdfSource("cloudwatch", RDF_FEEDS.cloudwatch, 20);
