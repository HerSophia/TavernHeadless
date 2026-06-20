/**
 * 画布编辑态注入键（B10 阶段 6）。
 *
 * `GraphCanvas` 经 `provide` 暴露编辑态（响应式），自定义节点 `GraphNode` 经 `inject`
 * 读取以决定端口 Handle 是否可连线——避免把编辑态打进纯映射 `map-document` 的节点 data。
 */
import type { InjectionKey, Ref } from "vue";

export const GRAPH_EDITABLE_KEY: InjectionKey<Ref<boolean>> = Symbol("graph-editable");
