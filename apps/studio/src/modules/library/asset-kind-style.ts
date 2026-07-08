/**
 * 资产类型的视觉样式与 monogram 工具（SC2-9）。
 *
 * 由 `AssetRow` / `LibrarySidebar` / `AssetDetailDrawer` 共享，避免各处重复类型色/图标映射。
 * 类型色沿用 SC2-2：character=accent / preset=success / worldbook=warn / regex=info（均为低饱和信号色）。
 */
import { BookOpen, Braces, FileText, User } from "lucide-vue-next";
import type { Component } from "vue";

import type { AssetKind } from "../../lib/assets/types";

/** 每类的图标 + 类型色（icon 前景 / bg 背景 tint）。 */
export interface AssetKindStyle {
  icon: Component;
  /** 图标 / monogram 文字色 class。 */
  text: string;
  /** monogram / chip 背景 tint class。 */
  bg: string;
}

export const KIND_STYLE: Record<AssetKind, AssetKindStyle> = {
  character: { icon: User, text: "text-signal-accent", bg: "bg-signal-accent/10" },
  preset: { icon: FileText, text: "text-signal-success", bg: "bg-signal-success/10" },
  worldbook: { icon: BookOpen, text: "text-signal-warn", bg: "bg-signal-warn/10" },
  regex: { icon: Braces, text: "text-signal-info", bg: "bg-signal-info/10" },
};

/**
 * 取资产名的首个可见码点作 monogram（大写）。
 *
 * 用 `Array.from` 按码点切分，正确处理多字节字符；空名返回 null（消费方用类型图标兜底）。
 */
export function monogram(name: string): string | null {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : null;
}
