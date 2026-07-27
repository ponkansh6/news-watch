export interface SourceDef {
  id: string;
  name: string;
}

export const SOURCES: SourceDef[] = [
  { id: "zenn", name: "Zenn" },
  { id: "qiita", name: "Qiita" },
  { id: "yamadashy", name: "Tech Blog" },
  { id: "itmedia", name: "@IT" },
  { id: "codezine", name: "CodeZine" },
  { id: "zdnet", name: "ZDNet Japan" },
  { id: "xtech", name: "日経クロステック" },
  { id: "hatena", name: "Hatena Blog" },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);
