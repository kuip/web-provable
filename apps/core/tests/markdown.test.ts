import { describe, expect, it } from "vitest";

import { parseMarkdownTemplate } from "../src/markdown";

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
});
