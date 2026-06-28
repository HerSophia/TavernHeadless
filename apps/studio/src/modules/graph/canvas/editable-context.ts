/**
 * 画布编辑态注入键（B10 阶段 6）。
 *
 * `GraphCanvas` 经 `provide` 暴露编辑态（响应式），自定义节点 `GraphNode` 经 `inject`
 * 读取以决定端口 Handle 是否可连线——避免把编辑态打进纯映射 `map-document` 的节点 data。
 */
import type { InjectionKey, Ref } from "vue";

export const GRAPH_EDITABLE_KEY: InjectionKey<Ref<boolean>> = Symbol("graph-editable");

/**
 * 组开关回调：`GraphGroupNode` 经 `inject` 取得，点击组容器上的开关时调用，由 `GraphCanvas`
 * 上抛 `toggleGroup` 事件 → store.setGroupEnabled。仅编辑态提供（只读态为 undefined）。
 */
export type GraphGroupToggle = (groupId: string, enabled: boolean) => void;
export const GRAPH_GROUP_TOGGLE_KEY: InjectionKey<GraphGroupToggle | undefined> = Symbol("graph-group-toggle");

/**
 * 折叠/展开回调：折叠节点上的展开按钮调用，`GraphCanvas` 上抛 `setGroupCollapsed` 事件 →
 * store.setGroupCollapsed。仅编辑态提供。
 */
export type GraphGroupCollapse = (groupId: string, collapsed: boolean) => void;
export const GRAPH_GROUP_COLLAPSE_KEY: InjectionKey<GraphGroupCollapse | undefined> = Symbol("graph-group-collapse");

/** 进入子图（drill-in）回调：折叠节点的「进入」按钮调用，`GraphCanvas` 上抛 `enterGroup`。 */
export type GraphGroupEnter = (groupId: string) => void;
export const GRAPH_GROUP_ENTER_KEY: InjectionKey<GraphGroupEnter | undefined> = Symbol("graph-group-enter");
