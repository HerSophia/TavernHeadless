/**
 * 图助手助手消息的 Markdown 渲染（楼层样式 · Markdown 支持）。
 *
 * 用 markdown-it 把助手回复渲染为 HTML，关闭原始 HTML 透传（html:false），
 * 只产出 markdown-it 自身生成的安全标签；组件侧再用 DOMPurify 兜底净化。
 *
 * ```mermaid 代码块特殊处理：渲染为占位容器，并保留转义后的图定义源码，
 * 由组件在 DOM 就绪后调用 mermaid 渲染为 SVG（流式期间只显示源码，不渲染图）。
 *
 * 本模块为纯函数（仅依赖 markdown-it），便于单测；不做 DOM 净化与 mermaid 渲染。
 */
import MarkdownIt from "markdown-it";

/** mermaid 占位容器类名：组件据此查找需要渲染的图块。 */
export const MERMAID_BLOCK_CLASS = "am-mermaid";

/** mermaid 源码元素类名：组件据此读取原始图定义文本。 */
export const MERMAID_SOURCE_CLASS = "am-mermaid__src";

const md = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// ```mermaid 围栏改写为占位容器：保留转义后的源码，交组件在 DOM 阶段渲染为 SVG。
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token?.info ?? "").trim().toLowerCase();
  if (token && info === "mermaid") {
    const source = md.utils.escapeHtml(token.content);
    return `<div class="${MERMAID_BLOCK_CLASS}"><pre class="${MERMAID_SOURCE_CLASS}">${source}</pre></div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/** 把助手回复 Markdown 渲染为 HTML（不净化，净化交由组件侧 DOMPurify）。 */
export function renderMarkdownToHtml(content: string): string {
  return md.render(content ?? "");
}
