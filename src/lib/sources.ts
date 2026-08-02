import { SOURCE_REGISTRY, SOURCE_IDS } from "@/lib/news/registry";

export interface SourceDef {
  id: string;
  name: string;
}

export const SOURCES: SourceDef[] = SOURCE_IDS.map((id) => ({
  id,
  name: SOURCE_REGISTRY[id].name,
}));

export { SOURCE_IDS };
