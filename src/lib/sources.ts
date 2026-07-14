export interface SourceDef {
  id: string;
  name: string;
  color: string;
}

export const SOURCES: SourceDef[] = [
  { id: "newsapi", name: "NewsAPI", color: "bg-green-500" },
  { id: "qiita", name: "Qiita", color: "bg-purple-500" },
  { id: "github", name: "GitHub", color: "bg-gray-700" },
  { id: "yamadashy", name: "Tech Blog", color: "bg-emerald-500" },
  { id: "itmedia", name: "ITmedia", color: "bg-red-500" },
  { id: "codezine", name: "CodeZine", color: "bg-orange-600" },
  { id: "zdnet", name: "ZDNet Japan", color: "bg-blue-600" },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);
