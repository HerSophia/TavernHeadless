/**
 * NodeGraph 编辑器快捷键单一事实源（NG2-6）。
 *
 * 设计参考 Blender Node Editor 的交互思想（鼠标优先加修饰键、连线优先、少菜单），
 * 抽象其思想而非照抄键位。这里集中定义键位与说明 i18n key，供快捷键绑定与说明浮层共用，
 * 避免键位散落各处、说明与实现漂移。
 */

/** 快捷键分区（用于说明浮层分组展示）。 */
export type ShortcutSection = "edit" | "connect" | "nav";

export interface ShortcutDefinition {
 /** 稳定标识（也作说明浮层的 key）。 */
  id: string;
  /**展示用的按键组合（原样等宽展示，不本地化）。 */
  keys: string;
  /** 说明文案的 i18n key（`graph.shortcuts.key.<id>`）。 */
  labelKey: string;
  section: ShortcutSection;
}

/**
 * 支持的快捷键清单。键位表达遵循 Blender 思想：
* - `Shift+A` 唤起节点搜索（add）；
 * - `Ctrl+D` 复制；`Ctrl+G` 成组；`X` / `Delete` 删除；
 * - `Ctrl+Z` 撤销，`Ctrl+Shift+Z` / `Ctrl+Y` 重做；
 * - `Alt+Drag` lazy connect；`Ctrl+Drag` cut connection（在画布交互层实现，这里仅登记说明）。
 */
export const GRAPH_SHORTCUTS: ShortcutDefinition[] = [
  { id: "addNode", keys: "Shift+A", labelKey: "graph.shortcuts.key.addNode", section: "edit" },
  { id: "duplicate", keys: "Ctrl+D", labelKey: "graph.shortcuts.key.duplicate", section: "edit" },
  { id: "group", keys: "Ctrl+G", labelKey: "graph.shortcuts.key.group", section: "edit" },
  { id: "delete", keys:"X / Delete", labelKey: "graph.shortcuts.key.delete", section: "edit" },
  { id: "undo", keys: "Ctrl+Z", labelKey: "graph.shortcuts.key.undo", section: "edit" },
  { id: "redo", keys: "Ctrl+Shift+Z / Ctrl+Y", labelKey: "graph.shortcuts.key.redo", section: "edit" },
  { id: "lazyConnect", keys: "Alt+Drag", labelKey: "graph.shortcuts.key.lazyConnect", section: "connect" },
  { id: "cutConnection", keys: "Ctrl+Drag", labelKey: "graph.shortcuts.key.cutConnection", section: "connect" },
];

/** 按分区聚合快捷键（供说明浮层分组）。 */
export function groupShortcutsBySection(): Array<{ section: ShortcutSection; items: ShortcutDefinition[] }> {
  const order: ShortcutSection[] = ["edit", "connect", "nav"];
  return order
    .map((section) => ({ section, items: GRAPH_SHORTCUTS.filter((shortcut) => shortcut.section === section) }))
    .filter((group) => group.items.length > 0);
}

/**
 * 判断当前焦点是否落在可编辑元素（输入框、文本域、下拉、contentEditable）。
 *
 * 落在可编辑元素时不响应画布快捷键，避免删除节点等操作误触发。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}
