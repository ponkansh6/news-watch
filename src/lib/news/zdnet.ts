import { createRdfSource, RDF_FEEDS } from "./feeds";
import { parseRdf, type StandardRdfItem } from "./base/rdf-parser";

export type ZdnetItem = StandardRdfItem;

export function parseZdnetRss(xml: string): ZdnetItem[] {
  return parseRdf(xml);
}

export const searchZdnet = createRdfSource("zdnet", RDF_FEEDS.zdnet);
