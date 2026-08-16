import { createRdfSource, RDF_FEEDS } from "./feeds";
import { parseRdf, type StandardRdfItem } from "./base/rdf-parser";

export type XtechItem = StandardRdfItem;

export function parseXtechRss(xml: string): XtechItem[] {
  return parseRdf(xml);
}

export const searchXtech = createRdfSource("xtech", RDF_FEEDS.xtech);
