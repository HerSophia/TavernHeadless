/**
 * 画布编辑态注入键（B10 阶段 6）。
 *
 * `GraphCanvas` 经 `provide` 暴露编辑态（响应式），自定义节点 `GraphNode` 经 `inject`
 * 读取以决定端口 Handle 是否可连线——避免把编辑态打进纯映射 `map-document` 的节点 data。
 */
import type { InjectionKey, Ref } from "vue";

import type { NodeGraphPortType } from "@tavern/core/node-graph";

export const GRAPH_EDITABLE_KEY: InjectionKey<Ref<boolean>> = Symbol("graph-editable");

/**
 * NG2-6：当前正在拖出连线的源输出端口类型（`null` = 未在连线）。
 * `GraphNode` 经 `inject` 读取，拖线时把输入端口按类型兼容点亮 / 不兼容置灰。
 */
export const GRAPH_CONNECTING_SOURCE_TYPE_KEY: InjectionKey<Ref<NodeGraphPortType | null>> = Symbol(
  "graph-connecting-source-type",
);

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
