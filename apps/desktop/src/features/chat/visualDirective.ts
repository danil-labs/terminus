import { fromMarkdown } from "mdast-util-from-markdown";

export type ChatVisual = { kind: "visual"; file: string; title: string; id: string };
export type VisualPart = ChatVisual | { kind: "markdown"; markdown: string };

const DIRECTIVE = /^::terminus-visual\{file=("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")(?: title=("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"))?\}$/;
export const MAX_CHAT_VISUALS = 8;

export function splitChatVisuals(text: string, streaming: boolean): VisualPart[] {
  if (!text.includes("::terminus-visual")) return [{ kind: "markdown", markdown: text }];
  const parts: VisualPart[] = [];
  let cursor = 0;
  let count = 0;
  const paragraphs = fromMarkdown(text).children.filter((node) => node.type === "paragraph");
  for (const line of text.matchAll(/^::terminus-visual[^\r\n]*/gm)) {
    const start = line.index;
    const end = start + line[0].length;
    if (count === MAX_CHAT_VISUALS || (streaming && end === text.length)) continue;
    const match = DIRECTIVE.exec(line[0]);
    if (!match) continue;
    const containsLine = (node: { position?: { start: { offset?: number }; end: { offset?: number } } }) =>
      (node.position?.start.offset ?? Infinity) <= start &&
      (node.position?.end.offset ?? -1) >= end;
    const paragraph = paragraphs.find(containsLine);
    if (!paragraph || paragraph.children.some((child) =>
      child.type === "inlineCode" &&
      (child.position?.start.offset ?? Infinity) <= start &&
      (child.position?.end.offset ?? -1) > start,
    )) continue;
    const file: string = JSON.parse(match[1]);
    const title: string = match[2] ? JSON.parse(match[2]) : "";
    if (file.length === 0 || file.length > 128 || title.length > 240) continue;
    parts.push({ kind: "markdown", markdown: text.slice(cursor, start) });
    parts.push({ kind: "visual", file, title, id: `${start}:${file}` });
    cursor = end;
    count += 1;
  }
  parts.push({ kind: "markdown", markdown: text.slice(cursor) });
  return parts;
}
