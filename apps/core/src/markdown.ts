export type MarkdownInline =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "code"; value: string }
  | { kind: "field"; id: string };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { kind: "paragraph"; children: MarkdownInline[] }
  | { kind: "field"; id: string }
  | { kind: "action"; id: string };

const standaloneField = /^\{\{field:([A-Za-z][A-Za-z0-9_-]*)\}\}$/;
const standaloneAction = /^\{\{action:([A-Za-z][A-Za-z0-9_-]*)\}\}$/;
const inlineToken = /\{\{field:([A-Za-z][A-Za-z0-9_-]*)\}\}|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

/**
 * Parses the inert Markdown subset used by app UI templates.
 *
 * The output is data rather than HTML, so the extension can render it with
 * DOM text nodes and controlled field components without accepting app HTML.
 */
export function parseMarkdownTemplate(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({
      kind: "paragraph",
      children: parseInline(paragraphLines.join(" ")),
    });
    paragraphLines = [];
  };

  for (const sourceLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = sourceLine.trim();
    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    const field = standaloneField.exec(line);
    if (field?.[1]) {
      flushParagraph();
      blocks.push({ kind: "field", id: field[1] });
      continue;
    }

    const action = standaloneAction.exec(line);
    if (action?.[1]) {
      flushParagraph();
      blocks.push({ kind: "action", id: action[1] });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function parseInline(value: string): MarkdownInline[] {
  const children: MarkdownInline[] = [];
  let offset = 0;
  inlineToken.lastIndex = 0;

  for (const match of value.matchAll(inlineToken)) {
    const index = match.index;
    if (index > offset) {
      children.push({ kind: "text", value: value.slice(offset, index) });
    }
    if (match[1]) {
      children.push({ kind: "field", id: match[1] });
    } else if (match[2]) {
      children.push({ kind: "strong", value: match[2] });
    } else if (match[3]) {
      children.push({ kind: "code", value: match[3] });
    }
    offset = index + match[0].length;
  }

  if (offset < value.length) {
    children.push({ kind: "text", value: value.slice(offset) });
  }
  return children;
}
