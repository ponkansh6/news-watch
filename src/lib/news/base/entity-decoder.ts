export function decodeEntities(input: unknown): string {
  if (input == null) return "";
  const str =
    typeof input === "object"
      ? String((input as Record<string, unknown>)["#text"] ?? "")
      : String(input);
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_: string, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
