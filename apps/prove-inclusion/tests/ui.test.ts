import { readFile } from "node:fs/promises";

import { parseMarkdownTabs } from "@provable/core";
import { describe, expect, it } from "vitest";

describe("Prove Inclusion UI", () => {
  it("keeps the guide in the final tab with hierarchical navigation headings", async () => {
    const markdown = await readFile(new URL("../ui.md", import.meta.url), "utf8");
    const tabs = parseMarkdownTabs(markdown);

    expect(tabs.map((tab) => tab.title)).toEqual([
      "Prove Inclusion",
      "Documentation & guide",
    ]);
    const documentation = tabs.at(-1);
    const headings = documentation?.blocks.flatMap((block) => (
      block.kind === "heading"
        ? [{ level: block.level, text: block.children.map((child) => (
          child.kind === "field" ? "" : child.value
        )).join("") }]
        : []
    ));
    expect(headings).toContainEqual({ level: 2, text: "Step-by-step guide" });
    expect(headings).toContainEqual({ level: 3, text: "2. Enter text A" });
    expect(headings).toContainEqual({ level: 4, text: "Preserve exact content" });
  });
});
