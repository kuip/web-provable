import { describe, expect, it } from "vitest";

import { parseMarkdownTabs, parseMarkdownTemplate } from "../src/markdown";

describe("parseMarkdownTemplate", () => {
  it("parses headings, fields, actions, and inert inline Markdown", () => {
    expect(parseMarkdownTemplate([
      "# Prove Inclusion",
      "",
      "Find **B** in `A`.",
      "",
      "{{field:a}}",
      "",
      "{{action:run}}",
    ].join("\n"))).toEqual([
      {
        kind: "heading",
        level: 1,
        children: [{ kind: "text", value: "Prove Inclusion" }],
      },
      {
        kind: "paragraph",
        children: [
          { kind: "text", value: "Find " },
          { kind: "strong", value: "B" },
          { kind: "text", value: " in " },
          { kind: "code", value: "A" },
          { kind: "text", value: "." },
        ],
      },
      { kind: "field", id: "a" },
      { kind: "action", id: "run" },
    ]);
  });

  it("keeps raw HTML inert as text", () => {
    expect(parseMarkdownTemplate("<script>alert('no')</script>")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "text", value: "<script>alert('no')</script>" }],
      },
    ]);
  });

  it("uses only lines of six or more hyphens as tab separators", () => {
    expect(parseMarkdownTabs([
      "# Run",
      "",
      "-----",
      "",
      "----------",
      "",
      "# Documentation",
      "",
      "## Chapter",
      "",
      "### Subchapter",
      "",
      "#### Subsubchapter",
      "",
      "##### Level five",
      "",
      "###### Level six",
    ].join("\n"))).toEqual([
      {
        title: "Run",
        blocks: [
          { kind: "heading", level: 1, children: [{ kind: "text", value: "Run" }] },
          { kind: "paragraph", children: [{ kind: "text", value: "-----" }] },
        ],
      },
      {
        title: "Documentation",
        blocks: [
          {
            kind: "heading",
            level: 1,
            children: [{ kind: "text", value: "Documentation" }],
          },
          { kind: "heading", level: 2, children: [{ kind: "text", value: "Chapter" }] },
          {
            kind: "heading",
            level: 3,
            children: [{ kind: "text", value: "Subchapter" }],
          },
          {
            kind: "heading",
            level: 4,
            children: [{ kind: "text", value: "Subsubchapter" }],
          },
          {
            kind: "heading",
            level: 5,
            children: [{ kind: "text", value: "Level five" }],
          },
          {
            kind: "heading",
            level: 6,
            children: [{ kind: "text", value: "Level six" }],
          },
        ],
      },
    ]);
  });

  it("requires non-empty tabs that start with level-one headings", () => {
    expect(() => parseMarkdownTabs("# Only one tab")).toThrow("six or more hyphens");
    expect(() => parseMarkdownTabs("# First\n------\n------\n# Last")).toThrow("empty tab");
    expect(() => parseMarkdownTabs("# First\n------\n## Missing title")).toThrow(
      "level-one heading",
    );
  });
});
