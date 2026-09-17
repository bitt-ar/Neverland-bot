export { cn } from "cn";

export function stripEmojis(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\u2b50\u2600-\u27bf\u2300-\u23ff\u2b05-\u2b55]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
