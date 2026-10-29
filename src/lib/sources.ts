import { SOURCE_REGISTRY, SOURCE_IDS, type SourceId } from "@/lib/news/registry";

/** A concrete source filter or the aggregate view over all registered sources. */
export type SourceSelection = SourceId | "all";

export function isSourceId(value: unknown): value is SourceId {
  return typeof value === "string" && SOURCE_IDS.some((sourceId) => sourceId === value);
}

export function isSourceSelection(value: unknown): value is SourceSelection {
  return value === "all" || isSourceId(value);
}

export interface SourceDef {
  id: SourceId;
  name: string;
}

export const SOURCES: SourceDef[] = SOURCE_IDS.map((id) => ({
  id,
  name: SOURCE_REGISTRY[id].name,
}));

export const SOURCE_FILTER_OPTIONS: Array<{ id: SourceSelection; name: string }> = [
  { id: "all", name: "総合" },
  ...SOURCES,
];

export { SOURCE_IDS };
