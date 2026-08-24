import { readFile } from "node:fs/promises";

import { parseMarkdownTabs } from "@provable/core";
import { describe, expect, it } from "vitest";

describe("Verify Kayros UI", () => {
  it("renders the app and documentation as two navigable tabs", async () => {
    const markdown = await readFile(new URL("../ui.md", import.meta.url), "utf8");
    const tabs = parseMarkdownTabs(markdown);

    expect(tabs.map((tab) => tab.title)).toEqual([
      "Verify Kayros",
      "Documentation & guide",
    ]);
    const documentation = tabs.at(-1);
    const headings = documentation?.blocks.flatMap((block) => (
      block.kind === "heading"
        ? [{
          level: block.level,
          text: block.children.map((child) => child.kind === "field" ? "" : child.value).join(""),
        }]
        : []
    ));
    expect(headings).toContainEqual({ level: 2, text: "Local hash construction" });
    expect(headings).toContainEqual({ level: 3, text: "Ordered fields" });
    expect(headings).toContainEqual({ level: 4, text: "First record" });
  });
});
