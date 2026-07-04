export const NODE_GRAPH_ANNOTATION_COMMENT_TYPE = 'annotation.comment' as const;

export const NODE_GRAPH_ANNOTATION_NODE_TYPES = [
  NODE_GRAPH_ANNOTATION_COMMENT_TYPE,
] as const;

export type NodeGraphAnnotationNodeType = (typeof NODE_GRAPH_ANNOTATION_NODE_TYPES)[number];

/**
 * 判断节点类型是否为编辑辅助注释节点。
 *
 * 注释节点只用于 Studio 编辑体验，不参与 NodeGraph 运行，也不产生 PromptIR 或持久输出。
 */
export function isNodeGraphAnnotationNodeType(type: string): type is NodeGraphAnnotationNodeType {
  return (NODE_GRAPH_ANNOTATION_NODE_TYPES as readonly string[]).includes(type);
}
