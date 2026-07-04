import { describe, expect, it } from "vitest";

import {
MERMAID_BLOCK_CLASS,
  MERMAID_SOURCE_CLASS,
  renderMarkdownToHtml,
} from "./assistant-markdown";

describe("renderMarkdownToHtml", () => {
  it("renders basic markdown (bold, list)", () => {
    const html = renderMarkdownToHtml("**hi**\n\n- a\n- b");
    expect(html).toContain("<strong>hi</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
  });

  it("escapes raw html (html disabled)", () => {
    const html = renderMarkdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps non-mermaid fenced code as a code block", () => {
    const html = renderMarkdownToHtml("```ts\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).not.toContain(MERMAID_BLOCK_CLASS);
  });

  it("renders a mermaid fence as a placeholder block keeping the source", () => {
    const html = renderMarkdownToHtml("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain(`class="${MERMAID_BLOCK_CLASS}"`);
    expect(html).toContain(`class="${MERMAID_SOURCE_CLASS}"`);
    // 源码被 HTML 转义后保留，箭头不会破坏标记
    expect(html).toContain("graph TD; A--&gt;B;");
  });

  it("matches mermaid info case-insensitively and trims", () => {
    const html = renderMarkdownToHtml("```  Mermaid \nflowchart LR\n```");
    expect(html).toContain(`class="${MERMAID_BLOCK_CLASS}"`);
  });

  it("returns empty string for empty content", () => {
    expect(renderMarkdownToHtml("")).toBe("");
  });
});
